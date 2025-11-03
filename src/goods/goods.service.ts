import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TelegramService } from '../telegram/telegram.service';
import { GoodEntity } from './entity/goods.entity';
import { DeliveryGoodsResponse, ShopGoodsItem } from './dto/goods-response.dto';
import { GoodStock } from './entity/good-stock.entity';

interface WarehouseConfig {
  name: string;
  displayName: string;
  sourceId: number;
}

@Injectable()
export class GoodsService {
  private readonly logger = new Logger(GoodsService.name);

  private readonly SHOP_API = 'https://greenleaf-global.com/api/v1/shop/goods';
  private readonly DELIVERY_API =
    'https://greenleaf-global.com/api/v1/delivery/goods/rest';

  private readonly warehouses: WarehouseConfig[] = [
    {
      name: 'almatyOld',
      displayName: 'Алматы Старый',
      sourceId: 715,
    },
    { name: 'almatyNew', displayName: 'Алматы Новый', sourceId: 1422 },
    {
      name: 'astanaOld',
      displayName: 'Астана Старый',
      sourceId: 139,
    },
    {
      name: 'astanaNew',
      displayName: 'Астана Новый',
      sourceId: 1388,
    },
  ];

  constructor(
    @InjectRepository(GoodEntity)
    private readonly goodsRepo: Repository<GoodEntity>,
    @InjectRepository(GoodStock)
    private readonly stockRepo: Repository<GoodStock>,
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

          const sourceMap = new Map<number, number>();
          const recipientMap = new Map<number, number>();

          if (
            src.length !== validIds.length ||
            rec.length !== validIds.length
          ) {
            this.logger.warn(
              `Длина src/rec не совпадает с validIds для склада ${wh.displayName}`,
            );
          }

          validIds.forEach((id, idx) => {
            sourceMap.set(id, src[idx] ?? 0);
            recipientMap.set(id, rec[idx] ?? 0);
          });

          acc[wh.name] = {
            source: sourceMap,
            recipient: recipientMap,
            displayName: wh.displayName,
          };
          return acc;
        },
        {} as Record<
          string,
          {
            source: Map<number, number>;
            recipient: Map<number, number>;
            displayName: string;
          }
        >,
      );

      for (const item of shopGoods) {
        if (!item) continue;

        const boxCount = this.extractCountInBox(item.title.ru) ?? Infinity;
        let good = await this.goodsRepo.findOne({
          where: { productId: item.id },
          relations: ['stocks'],
        });

        if (!good) {
          good = this.goodsRepo.create({
            productId: item.id,
            name: item.title.ru,
            price: item.price.store.kzt,
            link: `${item.path}/${item.name}`,
            stocks: [],
          });
          good = await this.goodsRepo.save(good);
        } else {
          good.price = item.price.store.kzt;
        }

        for (const wh of this.warehouses) {
          const sourceCount = warehouseMaps[wh.name].source.get(item.id) ?? 0;
          const recipientCount =
            warehouseMaps[wh.name].recipient.get(item.id) ?? 0;
          const displayName = warehouseMaps[wh.name].displayName;

          let stock = good.stocks.find((s) => s.warehouse === wh.name);

          if (!stock) {
            stock = new GoodStock();
            stock.warehouse = wh.name;
            stock.displayName = displayName;
            stock.sourceCount = sourceCount;
            stock.recipientCount = recipientCount;
            stock.good = good;
            good.stocks.push(stock);
            await this.stockRepo.save(stock);
          } else {
            const diff = sourceCount - stock.sourceCount;

            if (
              sourceCount > stock.sourceCount &&
              sourceCount > 0 &&
              ((boxCount === Infinity && diff > 0) ||
                (boxCount !== Infinity && diff > boxCount))
            ) {
              const productIdStr = `0000${good.productId}`;
              const message = `📦 *Товар увеличился на складе ${stock.displayName}:*\n🆔 ID: \`${productIdStr}\`\n📦 Название: *${good.name}*\n📉 Было: ${stock.sourceCount}\n📈 Стало: ${sourceCount}`;

              this.logger.warn(message.replace(/\*/g, ''));
              await this.telegramService.sendMessageToAll(message, {
                parse_mode: 'Markdown',
              });
            }

            stock.sourceCount = sourceCount;
            stock.recipientCount = recipientCount;
            await this.stockRepo.save(stock);
          }
        }

        await this.goodsRepo.save(good);
      }

      offset += batchSize;
      this.logger.log(`Обработано товаров до offset=${offset}`);
    }

    this.logger.log('Обновление товаров завершено.');
  }
}
