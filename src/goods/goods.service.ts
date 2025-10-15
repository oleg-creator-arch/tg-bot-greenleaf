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
    sourceIds: number[],
    recipientIds: number[],
  ): Promise<DeliveryGoodsResponse> {
    try {
      const body = [
        [715, sourceIds],
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

      const delivery = await this.fetchDeliveryGoods(sourceIds, recipientIds);
      const sourceMap = new Map<number, number>();
      const recipientMap = new Map<number, number>();

      const sourceArray: number[] = delivery[0] ?? [];
      const recipientArray: number[] = delivery[1] ?? [];

      sourceIds.forEach((id, idx) => {
        const count: number = sourceArray[idx] ?? 0;
        sourceMap.set(id, count);
      });

      recipientIds.forEach((id, idx) => {
        const count: number = recipientArray[idx] ?? 0;
        recipientMap.set(id, count);
      });

      for (const item of shopGoods) {
        if (!item) continue;

        const countSource = sourceMap.get(item.id) ?? 0;
        const countRecipient = recipientMap.get(item.id) ?? 0;

        const existing = await this.goodsRepo.findOneBy({ productId: item.id });

        if (!existing) {
          const newGood = this.goodsRepo.create({
            productId: item.id,
            name: item.title.ru,
            price: item.price.store.kzt,
            countSource,
            countRecipient,
            link: `${item.path}/${item.name}`,
          });
          await this.goodsRepo.save(newGood);
        } else {
          if (countSource > existing.countSource) {
            this.logger.warn(
              `Товар увеличился на складе: ${existing.name} (ID: ${existing.productId}) с ${existing.countSource} → ${countSource}`,
            );
            await this.telegramService.sendMessage(
              `📦 Товар увеличился на складе: ${existing.name}\nСтарое количество: ${existing.countSource} ед.\nНовое количество: ${countSource} ед.`,
            );
          }

          existing.countSource = countSource;
          existing.countRecipient = countRecipient;
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
