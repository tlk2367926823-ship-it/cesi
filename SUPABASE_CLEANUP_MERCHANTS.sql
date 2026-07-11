-- 清理重复测试商家，并确认正式商家 ID。
-- 在 Supabase SQL Editor 中运行。

-- 1. 删除测试商家A。测试阶段误插入的两条都可以清理掉。
delete from public.merchants
where name = '测试商家A';

-- 2. 确认深圳汇职驾校这条真实商家存在。
-- 如果已经存在，不会重复插入。
insert into public.merchants (id, name, industry, contact_name, contact_phone, status)
values (
  'a90fd384-a296-4a95-98dd-b3e79fc36d93',
  '深圳汇职驾校',
  '驾校培训',
  '测试联系人',
  '13800000000',
  'active'
)
on conflict (id) do update
set
  name = excluded.name,
  industry = excluded.industry,
  status = excluded.status,
  updated_at = now();

-- 3. 查看当前商家列表，确认只保留需要的商家。
select id, name, industry, status, created_at
from public.merchants
order by created_at desc;
