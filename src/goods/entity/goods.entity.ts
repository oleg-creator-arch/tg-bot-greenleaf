import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { GoodStock } from './good-stock.entity';

@Entity('goods')
export class GoodEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  productId: number;

  @Column()
  name: string;

  @Column({ type: 'int', default: 0 })
  price: number;

  @Column()
  link: string;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany(() => GoodStock, (stock) => stock.good)
  stocks: GoodStock[];
}
