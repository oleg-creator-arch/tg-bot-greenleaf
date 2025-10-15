import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GoodsService } from './goods.service';
import { GoodsScheduler } from './goods.scheduler';
import { GoodEntity } from './entity/goods.entity';
import { TelegramModule } from 'src/telegram/telegram.module';

@Module({
  imports: [TypeOrmModule.forFeature([GoodEntity]), TelegramModule],
  providers: [GoodsService, GoodsScheduler],
  exports: [GoodsService],
})
export class GoodsModule {}
