import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GoodsService } from './goods.service';

@Injectable()
export class GoodsScheduler {
  private readonly logger = new Logger(GoodsScheduler.name);

  constructor(private readonly goodsService: GoodsService) {}

  async onModuleInit() {
    this.logger.log('Приложение запущено — выполняем первый поиск товаров...');
    await this.handleCron();
  }

  @Cron('*/15 * * * *')
  async handleCron() {
    this.logger.log('Запуск проверки товаров...');
    await this.goodsService.updateGoods();
  }
}
