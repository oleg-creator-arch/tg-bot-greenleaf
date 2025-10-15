import { Injectable, Logger } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsersEntity } from 'src/users/entity/users.entity';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private lastSentTime = 0;
  private readonly delayMs = 1000;

  constructor(
    @InjectBot() private readonly bot: Telegraf,
    @InjectRepository(UsersEntity)
    private readonly usersRepo: Repository<UsersEntity>,
  ) {
    this.bot.start(async (ctx) => {
      const id = ctx.chat?.id;
      if (id) {
        const existing = await this.usersRepo.findOneBy({ chatId: id });
        if (!existing) {
          const user = this.usersRepo.create({ chatId: id });
          await this.usersRepo.save(user);
        }
      }
      await ctx.reply('👋 Привет! Теперь вы будете получать уведомления.');
    });
  }

  async sendMessage(message: string) {
    const users = await this.usersRepo.find();
    for (const user of users) {
      try {
        const now = Date.now();
        const diff = now - this.lastSentTime;
        if (diff < this.delayMs) {
          await sleep(this.delayMs - diff);
        }

        await this.bot.telegram.sendMessage(user.chatId, message);
        this.lastSentTime = Date.now();
      } catch (error) {
        this.logger.error(
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }
}
