import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TelegramService } from '../telegram/telegram.service';
import { GoodEntity } from './entity/goods.entity';
import { DeliveryGoodsResponse, ShopGoodsItem } from './dto/goods-response.dto';

@Injectable()
export class GoodsService {
  private readonly logger = new Logger(GoodsService.name);

  private readonly SHOP_API = 'https://greenleaf-global.com/api/v1/shop/goods';
  private readonly DELIVERY_API =
    'https://greenleaf-global.com/api/v1/delivery/goods/rest';

  constructor(
    @InjectRepository(GoodEntity)
    private readonly goodsRepo: Repository<GoodEntity>,
    private readonly telegramService: TelegramService,
  ) {}

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
    city: 'Astana' | 'Almaty',
    sourceIds: number[],
    recipientIds: number[],
  ): Promise<DeliveryGoodsResponse> {
    try {
      let sourceId;

      switch (city) {
        case 'Astana':
          sourceId = 139;
          break;
        case 'Almaty':
          sourceId = 715;
          break;
        default:
          sourceId = 139;
      }
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

      if (!shopGoods || shopGoods.length === 0) {
        this.logger.log(`Достигнут конец списка товаров на offset=${offset}`);
        break;
      }

      const sourceIds = shopGoods.map((g) => g.id).filter((id) => id != null);
      const recipientIds = shopGoods
        .map((g) => g.id)
        .filter((id) => id != null);

      if (sourceIds.length === 0 && recipientIds.length === 0) {
        this.logger.warn(
          `Нет доступных ID для доставки на offset=${offset}, пропускаем батч`,
        );
        offset += batchSize;
        continue;
      }

      const deliveryAlmaty = await this.fetchDeliveryGoods(
        'Almaty',
        sourceIds,
        recipientIds,
      );
      const deliveryAstana = await this.fetchDeliveryGoods(
        'Astana',
        sourceIds,
        recipientIds,
      );
      const sourceMapAlmaty = new Map<number, number>();
      const recipientMapAlmaty = new Map<number, number>();
      const sourceMapAstana = new Map<number, number>();
      const recipientMapAstana = new Map<number, number>();

      const sourceArrayAlmaty: number[] = deliveryAlmaty[0] ?? [];
      const recipientArrayAlmaty: number[] = deliveryAlmaty[1] ?? [];

      const sourceArrayAstana: number[] = deliveryAstana[0] ?? [];
      const recipientArrayAstana: number[] = deliveryAstana[1] ?? [];

      sourceIds.forEach((id, idx) => {
        const count: number = sourceArrayAlmaty[idx] ?? 0;
        sourceMapAlmaty.set(id, count);
      });

      recipientIds.forEach((id, idx) => {
        const count: number = recipientArrayAlmaty[idx] ?? 0;
        recipientMapAlmaty.set(id, count);
      });

      sourceIds.forEach((id, idx) => {
        const count: number = sourceArrayAstana[idx] ?? 0;
        sourceMapAstana.set(id, count);
      });

      recipientIds.forEach((id, idx) => {
        const count: number = recipientArrayAstana[idx] ?? 0;
        recipientMapAstana.set(id, count);
      });

      for (const item of shopGoods) {
        if (!item) continue;

        const countSourceAlmaty = sourceMapAlmaty.get(item.id) ?? 0;
        const countRecipientAlmaty = recipientMapAlmaty.get(item.id) ?? 0;
        const countSourceAstana = sourceMapAstana.get(item.id) ?? 0;
        const countRecipientAstana = recipientMapAstana.get(item.id) ?? 0;

        const existing = await this.goodsRepo.findOneBy({ productId: item.id });

        if (!existing) {
          const newGood = this.goodsRepo.create({
            productId: item.id,
            name: item.title.ru,
            price: item.price.store.kzt,
            countSourceAlmaty: countSourceAlmaty,
            countSourceAstana: countSourceAstana,
            countRecipientAlmaty: countRecipientAlmaty,
            countRecipientAstana: countRecipientAstana,
            link: `${item.path}/${item.name}`,
          });
          await this.goodsRepo.save(newGood);
        } else {
          if (countSourceAlmaty > existing.countSourceAlmaty) {
            const productIdStr = `0000${existing.productId}`;

            this.logger.warn(
              `Товар увеличился на складе Алматы: ${existing.name} (ID: ${productIdStr}) с ${existing.countSourceAlmaty} → ${countSourceAlmaty}`,
            );

            await this.telegramService.sendMessageToAll(
              `📦 *Товар увеличился на складе Алматы:*\n` +
                `🆔 ID: \`${productIdStr}\`\n` +
                `📦 Название: *${existing.name}*\n` +
                `📉 Было: ${existing.countSourceAlmaty}\n` +
                `📈 Стало: ${countSourceAlmaty}`,
              { parse_mode: 'Markdown' },
            );
          }

          if (countSourceAstana > existing.countSourceAstana) {
            const productIdStr = `0000${existing.productId}`;

            this.logger.warn(
              `Товар увеличился на складе Астана: ${existing.name} (ID: ${productIdStr}) с ${existing.countSourceAstana} → ${countSourceAstana}`,
            );

            await this.telegramService.sendMessageToAll(
              `📦 *Товар увеличился на складе Астана:*\n` +
                `🆔 ID: \`${productIdStr}\`\n` +
                `📦 Название: *${existing.name}*\n` +
                `📉 Было: ${existing.countSourceAstana}\n` +
                `📈 Стало: ${countSourceAstana}`,
              { parse_mode: 'Markdown' },
            );
          }

          existing.countSourceAlmaty = countSourceAlmaty;
          existing.countSourceAstana = countSourceAstana;
          existing.countRecipientAlmaty = countRecipientAlmaty;
          existing.countRecipientAstana = countRecipientAstana;
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
