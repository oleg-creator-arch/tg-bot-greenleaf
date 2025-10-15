export interface ShopGoodsItem {
  id: number;
  title: {
    ru: string;
    [key: string]: string;
  };
  price: {
    store: {
      kzt: number;
    };
  };
  path: string;
  name: string;
}

export type DeliveryGoodsResponse = [number[], number[]];
