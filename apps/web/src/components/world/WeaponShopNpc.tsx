import type { RoomMerchantCategory, RoomMerchantType } from '@social-sena/shared'
import { WorldNpc, type WorldNpcProps } from './WorldNpc'

export interface WeaponShopNpcProps extends WorldNpcProps {
  merchantType: RoomMerchantType
  categories: readonly RoomMerchantCategory[]
}

export function WeaponShopNpc({ merchantType, categories, ...worldNpcProps }: WeaponShopNpcProps) {
  const availableCategories = [...new Set(categories)]

  return (
    <div
      className="weapon-shop-npc"
      data-merchant-type={merchantType}
      data-merchant-categories={availableCategories.join(',')}
      style={{ display: 'contents' }}
    >
      <WorldNpc {...worldNpcProps} />
    </div>
  )
}
