import { Injectable, Logger } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { UsersEntity } from 'src/users/entity/users.entity';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface TelegramErrorResponse {
  error_code: number;
  description?: string;
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
  ) {}

  async subscribe(chatId: number) {
    const existing = await this.usersRepo.findOneBy({ chatId });
    if (!existing) {
      const user = this.usersRepo.create({ chatId });
      await this.usersRepo.save(user);
      this.logger.log(`Добавлен новый пользователь ${chatId}`);
    }
  }

  async unsubscribe(chatId: number) {
    await this.usersRepo.delete({ chatId });
    this.logger.log(`Пользователь ${chatId} удалён из базы`);
  }

  async sendMessageToAll(message: string) {
    const users = await this.usersRepo.find();
    for (const user of users) {
      await this.sendMessage(user.chatId, message);
    }
  }

  private async sendMessage(chatId: number, message: string) {
    try {
      const now = Date.now();
      const diff = now - this.lastSentTime;
      if (diff < this.delayMs) await sleep(this.delayMs - diff);

      await this.bot.telegram.sendMessage(chatId, message);
      this.lastSentTime = Date.now();
      this.logger.log(`Сообщение отправлено пользователю ${chatId}`);
    } catch (err: unknown) {
      if (
        err &&
        typeof err === 'object' &&
        'response' in err &&
        err.response &&
        typeof err.response === 'object'
      ) {
        const response = err.response as TelegramErrorResponse;
        if (response.error_code === 403) {
          await this.unsubscribe(chatId);
          this.logger.warn(
            `Пользователь ${chatId} заблокировал бота и удалён из базы`,
          );
          return;
        }
      }

      this.logger.error(
        `Ошибка при отправке пользователю ${chatId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async reply(ctx: { reply: (text: string) => Promise<any> }, text: string) {
    try {
      await ctx.reply(text);
    } catch (err) {
      this.logger.error(
        `Ошибка при отправке ответа в чате: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
