import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';

dotenv.config();

// Warnning
const old_console_warn = console.warn;
console.warn = function (message?: any, ...optionalParams: any[]) {
  if (message?.includes('[YOUTUBEJS][Parser]')) {
    return;
  }
  if (message?.message?.includes('This is a bug')) {
    return;
  }
  if (typeof message != 'object') {
    old_console_warn(message, optionalParams);
    return;
  }
  old_console_warn(message, optionalParams);
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    methods: ['GET'],
    origin: [
      'https://vtuberthaiinfo.com',
      'https://www.vtuberthaiinfo.com',
      'http://localhost:3001',
      'https://kfn.moe',
      'https://missyouluna.vercel.app'
    ],
  });
  await app.listen(process.env.PORT || 3000);
}
bootstrap();
