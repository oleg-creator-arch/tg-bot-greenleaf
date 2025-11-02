import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TelegramService } from '../telegram/telegram.service';
import { GoodEntity } from './entity/goods.entity';
import { DeliveryGoodsResponse, ShopGoodsItem } from './dto/goods-response.dto';

interface WarehouseConfig {
  name: string;
  sourceId: number;
}

@Injectable()
export class GoodsService {
  private readonly logger = new Logger(GoodsService.name);

  private readonly SHOP_API = 'https://greenleaf-global.com/api/v1/shop/goods';
  private readonly DELIVERY_API =
    'https://greenleaf-global.com/api/v1/delivery/goods/rest';

  private readonly warehouses: WarehouseConfig[] = [
    { name: 'АлматыСтарый', sourceId: 715 },
    { name: 'АлматыНовый', sourceId: 1422 },
    { name: 'АстанаСтарый', sourceId: 139 },
    { name: 'АстанаНовый', sourceId: 1388 },
  ];

  constructor(
    @InjectRepository(GoodEntity)
    private readonly goodsRepo: Repository<GoodEntity>,
    private readonly telegramService: TelegramService,
  ) {}

  /** Извлекает "в коробке N шт" из названия товара */
  private extractCountInBox(name: string): number | null {
    const match = name.match(/\((?:Кол-во\s+)?в\s*коробке\s*(\d+)\s*шт\)/i);
    return match ? parseInt(match[1], 10) : null;
  }

  async fetchShopGoods(ids: number[]): Promise<ShopGoodsItem[]> {
    try {
      const response = await axios.post<ShopGoodsItem[]>(this.SHOP_API, ids);
      return response.data.filter((item) => item !== null);
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  async fetchDeliveryGoods(
    sourceId: number,
    sourceIds: number[],
    recipientIds: number[],
  ): Promise<DeliveryGoodsResponse> {
    try {
      const body = [
        [sourceId, sourceIds],
        [254, recipientIds],
      ];
      const response = await axios.post<DeliveryGoodsResponse>(
        this.DELIVERY_API,
        body,
      );
      return response.data;
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : String(error));
      return [[], []];
    }
  }

  async updateGoods(): Promise<void> {
    this.logger.log('Начинаем обновление товаров...');
    const batchSize = 200;
    let offset = 0;

    while (true) {
      const batchIds = Array.from({ length: batchSize }, (_, i) => i + offset);
      const shopGoods = await this.fetchShopGoods(batchIds);

      if (!shopGoods.length) {
        this.logger.log(`Достигнут конец списка товаров (offset=${offset})`);
        break;
      }

      const validIds = shopGoods.map((g) => g.id).filter(Boolean);

      const deliveries = await Promise.all(
        this.warehouses.map(async (wh) => ({
          ...wh,
          data: await this.fetchDeliveryGoods(wh.sourceId, validIds, validIds),
        })),
      );

      const warehouseMaps = deliveries.reduce(
        (acc, wh) => {
          const [src, rec] = wh.data;
          acc[wh.name] = {
            source: new Map(validIds.map((id, idx) => [id, src[idx] ?? 0])),
            recipient: new Map(validIds.map((id, idx) => [id, rec[idx] ?? 0])),
          };
          return acc;
        },
        {} as Record<
          string,
          { source: Map<number, number>; recipient: Map<number, number> }
        >,
      );

      for (const item of shopGoods) {
        if (!item) continue;

        const boxCount = this.extractCountInBox(item.title.ru) ?? Infinity;
        const existing = await this.goodsRepo.findOneBy({ productId: item.id });

        if (!existing) {
          const newGood = this.goodsRepo.create({
            productId: item.id,
            name: item.title.ru,
            price: item.price.store.kzt,
            link: `${item.path}/${item.name}`,
            ...Object.fromEntries(
              this.warehouses.flatMap((wh) => [
                [
                  `countSource${wh.name}`,
                  warehouseMaps[wh.name].source.get(item.id) ?? 0,
                ],
                [
                  `countRecipient${wh.name}`,
                  warehouseMaps[wh.name].recipient.get(item.id) ?? 0,
                ],
              ]),
            ),
          });
          await this.goodsRepo.save(newGood);
        } else {
          for (const wh of this.warehouses) {
            const newCount = warehouseMaps[wh.name].source.get(item.id) ?? 0;
            const fieldName = `countSource${wh.name}` as keyof GoodEntity;
            const oldCount = (existing[fieldName] as number) ?? 0;

            if (newCount <= oldCount || newCount < 0) continue;

            if (
              newCount > oldCount &&
              newCount > boxCount &&
              boxCount !== Infinity
            ) {
              const productIdStr = `0000${existing.productId}`;
              const message = `📦 *Товар увеличился на складе ${wh.name}:*\n🆔 ID: \`${productIdStr}\`\n📦 Название: *${existing.name}*\n📉 Было: ${oldCount}\n📈 Стало: ${newCount}\n📦 В коробке: ${boxCount} шт`;

              this.logger.warn(message.replace(/\*/g, ''));
              await this.telegramService.sendMessageToAll(message, {
                parse_mode: 'Markdown',
              });
            }

            existing[`countSource${wh.name}`] = newCount;
            existing[`countRecipient${wh.name}`] =
              warehouseMaps[wh.name].recipient.get(item.id) ?? 0;
          }

          existing.price = item.price.store.kzt;
          await this.goodsRepo.save(existing);
        }
      }

      offset += batchSize;
      this.logger.log(`Обработано товаров до offset=${offset}`);
    }

    this.logger.log('Обновление товаров завершено.');
  }
}
