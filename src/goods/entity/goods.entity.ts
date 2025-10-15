import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

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

  @Column({ type: 'int', default: 0 })
  countSource: number;

  @Column({ type: 'int', default: 0 })
  countRecipient: number;

  @Column()
  link: string;

  @CreateDateColumn()
  createdAt: Date;
}
