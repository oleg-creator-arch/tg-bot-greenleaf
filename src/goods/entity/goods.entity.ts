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
  countSourceAstana: number;

  @Column({ type: 'int', default: 0 })
  countSourceAlmaty: number;

  @Column({ type: 'int', default: 0 })
  countRecipientAstana: number;

  @Column({ type: 'int', default: 0 })
  countRecipientAlmaty: number;

  @Column()
  link: string;

  @CreateDateColumn()
  createdAt: Date;
}
