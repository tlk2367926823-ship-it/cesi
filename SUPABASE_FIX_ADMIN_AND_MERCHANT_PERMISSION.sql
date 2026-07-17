-- Run this in Supabase SQL Editor when the admin page says:
-- "没有权限编辑这个商家"
--
-- What it does:
-- 1. Makes 2367926823@qq.com an admin account, able to edit every merchant.
-- 2. Makes huizhi@test.com a merchant account bound to 汇职驾校.
--
-- You can change the emails or merchant name if you create new merchant accounts later.

insert into public.profiles (id, role, merchant_id)
select
  users.id,
  'admin',
  null
from auth.users as users
where users.email = '2367926823@qq.com'
on conflict (id) do update
set
  role = excluded.role,
  merchant_id = excluded.merchant_id;

insert into public.profiles (id, role, merchant_id)
select
  users.id,
  'merchant',
  merchants.id
from auth.users as users
cross join public.merchants as merchants
where users.email = 'huizhi@test.com'
  and merchants.name = '汇职驾校'
on conflict (id) do update
set
  role = excluded.role,
  merchant_id = excluded.merchant_id;

select
  users.email,
  profiles.role,
  profiles.merchant_id,
  merchants.name as merchant_name
from public.profiles as profiles
join auth.users as users on users.id = profiles.id
left join public.merchants as merchants on merchants.id = profiles.merchant_id
where users.email in ('2367926823@qq.com', 'huizhi@test.com');
