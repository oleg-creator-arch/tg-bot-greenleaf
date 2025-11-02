import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { GoodEntity } from './goods.entity';

@Entity('good_stock')
export class GoodStock {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => GoodEntity, (good) => good.stocks, {
    onDelete: 'CASCADE',
    nullable: false, // обязательная связь
  })
  @JoinColumn({ name: 'good_id' })
  good: GoodEntity;

  @Column()
  warehouse: string;

  @Column()
  displayName: string;

  @Column({ type: 'int', default: 0 })
  sourceCount: number;

  @Column({ type: 'int', default: 0 })
  recipientCount: number;
}
