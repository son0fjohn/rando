-- The new wardrobe's shop (avatar4, web/items4.js): the shop now covers
-- headwear, face accessories and neck/back items too, every item carries its
-- rarity, and these items + hair dyes are what's for sale. Everything not
-- listed here is free. Prices are the real ones (items4.js only labels them).
-- Rows from the old wardrobe stay (inventory references them) but the client
-- no longer lists them: their values don't exist in the new catalogue.
-- The ownership lock (_check_owned_cosmetics) works per (slot, value), so it
-- covers the new slots with no change.

alter table shop_items drop constraint if exists shop_items_slot_check;
alter table shop_items add constraint shop_items_slot_check
  check (slot in ('hair', 'hairColor', 'top', 'bottom', 'shoes', 'head', 'face', 'neck'));
alter table shop_items add column if not exists rarity text not null default 'rare';
alter table shop_items drop constraint if exists shop_items_rarity_check;
alter table shop_items add constraint shop_items_rarity_check check (rarity in ('common', 'rare', 'epic'));

insert into shop_items (id, slot, value, name, price, rarity) values
  ('a4-wolf', 'hair', 'wolf', 'wolf cut', 80, 'rare'),
  ('a4-pigtails', 'hair', 'pigtails', 'pigtails', 80, 'rare'),
  ('a4-ponytail', 'hair', 'ponytail', 'high ponytail', 80, 'rare'),
  ('a4-spiky', 'hair', 'spiky', 'spiky bleached tips', 150, 'epic'),
  ('a4-afro-puff', 'hair', 'afro-puff', 'high puff', 150, 'epic'),
  ('a4-trucker', 'head', 'trucker', 'trucker cap', 80, 'rare'),
  ('a4-bandana-band', 'head', 'bandana-band', 'bandana headband', 80, 'rare'),
  ('a4-beanie-pixel', 'head', 'beanie-pixel', 'pixel beanie', 80, 'rare'),
  ('a4-earmuffs', 'head', 'earmuffs', 'earmuffs', 150, 'epic'),
  ('a4-hood', 'head', 'hood', 'hood up', 150, 'epic'),
  ('a4-star-sticker', 'face', 'star-sticker', 'star sticker', 80, 'rare'),
  ('a4-nose-ring', 'face', 'nose-ring', 'nose ring', 80, 'rare'),
  ('a4-hoops', 'face', 'hoops', 'hoop earrings', 80, 'rare'),
  ('a4-shades-wrap', 'face', 'shades-wrap', 'wraparound shades', 150, 'epic'),
  ('a4-bandana-mask', 'face', 'bandana-mask', 'bandana mask', 150, 'epic'),
  ('a4-zip-hoodie', 'top', 'zip-hoodie', 'gray zip hoodie', 80, 'rare'),
  ('a4-baby-tee', 'top', 'baby-tee', 'baby tee', 80, 'rare'),
  ('a4-denim-jacket', 'top', 'denim-jacket', 'denim jacket', 150, 'epic'),
  ('a4-crop-flannel', 'top', 'crop-flannel', 'crop top + flannel', 150, 'epic'),
  ('a4-skirt-pleated', 'bottom', 'skirt-pleated', 'pleated skirt', 80, 'rare'),
  ('a4-mini-leggings', 'bottom', 'mini-leggings', 'mini skirt + leggings', 80, 'rare'),
  ('a4-skirt-long', 'bottom', 'skirt-long', 'long flowy skirt', 150, 'epic'),
  ('a4-maryjanes', 'shoes', 'maryjanes', 'mary janes + socks', 80, 'rare'),
  ('a4-platform', 'shoes', 'platform', 'platform sneakers', 150, 'epic'),
  ('a4-chain-gold', 'neck', 'chain-gold', 'gold chain', 80, 'rare'),
  ('a4-scarf', 'neck', 'scarf', 'chunky scarf', 80, 'rare'),
  ('a4-sling', 'neck', 'sling', 'sling bag', 80, 'rare'),
  ('a4-backpack', 'neck', 'backpack', 'small backpack', 150, 'epic'),
  ('a4-skateboard', 'neck', 'skateboard', 'skateboard on back', 150, 'epic'),
  ('a4-haircolor-platinum', 'hairColor', 'platinum', 'platinum hair dye', 80, 'rare'),
  ('a4-haircolor-red', 'hairColor', 'red', 'red hair dye', 80, 'rare'),
  ('a4-haircolor-navy', 'hairColor', 'navy', 'navy hair dye', 80, 'rare'),
  ('a4-haircolor-pink', 'hairColor', 'pink', 'pink hair dye', 150, 'epic'),
  ('a4-haircolor-mint', 'hairColor', 'mint', 'mint hair dye', 150, 'epic'),
  ('a4-haircolor-purple', 'hairColor', 'purple', 'purple hair dye', 150, 'epic')
on conflict (slot, value) do update set name = excluded.name, price = excluded.price, rarity = excluded.rarity;
