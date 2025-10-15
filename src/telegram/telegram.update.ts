import { Update, Start, Help, Ctx } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { TelegramService } from './telegram.service';

@Update()
export class TelegramUpdate {
  constructor(private readonly telegramService: TelegramService) {}

  @Start()
  async onStart(@Ctx() ctx: Context) {
    await ctx.reply('👋 Привет! Это GreenLeaf бот 🌿');
  }

  @Help()
  async onHelp(@Ctx() ctx: Context) {
    await ctx.reply('Напиши что угодно — я повторю твое сообщение.');
  }
}
