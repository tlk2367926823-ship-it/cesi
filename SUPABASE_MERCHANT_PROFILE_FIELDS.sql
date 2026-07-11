alter table public.merchants
  add column if not exists address text,
  add column if not exists description text,
  add column if not exists selling_points text[] not null default '{}',
  add column if not exists xiaohongshu_url text,
  add column if not exists meituan_url text,
  add column if not exists dianping_url text,
  add column if not exists image_urls text[] not null default '{}',
  add column if not exists prompt_profile text;

update public.merchants
set
  industry = coalesce(industry, '驾校培训'),
  address = coalesce(address, '深圳'),
  description = coalesce(description, '深圳本地驾驶培训服务，适合准备报名学车、想了解练车安排和教练服务的用户。'),
  selling_points = case
    when cardinality(selling_points) = 0 then array['本地训练场', '教练讲解细', '流程清楚', '适合新手', '练车安排透明']
    else selling_points
  end,
  meituan_url = coalesce(meituan_url, 'http://dpurl.cn/KgRUKrtz'),
  dianping_url = coalesce(dianping_url, 'https://m.dianping.com/shopshare/k394wSQFIF53x0Ng?msource=Appshare2021&utm_source=shop_share&shoptype=&shopcategoryid=&isoversea=&shareid=s1Uu9Rgjqw_1783613632'),
  image_urls = case
    when cardinality(image_urls) = 0 then array[
      '/mock-assets/huizhi-car-yard-01.jpg',
      '/mock-assets/huizhi-training-base-02.jpg',
      '/mock-assets/huizhi-practice-car-03.jpg',
      '/mock-assets/huizhi-driving-closeup-04.jpg',
      '/mock-assets/huizhi-coach-guidance-05.jpg'
    ]
    else image_urls
  end,
  prompt_profile = coalesce(prompt_profile, '用真实学员体验的口吻，突出练车安排、教练沟通、训练场和报名咨询，不要夸大承诺。')
where name like '%汇职%' or name like '%驾校%';
