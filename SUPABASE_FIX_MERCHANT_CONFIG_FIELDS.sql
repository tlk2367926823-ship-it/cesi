-- Run this once in Supabase SQL Editor.
-- It adds all fields used by the merchant profile/admin configuration page.

alter table public.merchants
  add column if not exists address text,
  add column if not exists description text,
  add column if not exists selling_points text[] not null default '{}',
  add column if not exists xiaohongshu_url text,
  add column if not exists meituan_url text,
  add column if not exists dianping_url text,
  add column if not exists image_urls text[] not null default '{}',
  add column if not exists service_keywords text[] not null default '{}',
  add column if not exists feature_keywords text[] not null default '{}',
  add column if not exists length_options text[] not null default '{}',
  add column if not exists prompt_profile text;

update public.merchants
set
  industry = coalesce(nullif(industry, ''), '本地生活'),
  address = coalesce(nullif(address, ''), '深圳'),
  description = coalesce(nullif(description, ''), '适合本地商家用于生成真实体验型分享内容。'),
  selling_points = case
    when cardinality(selling_points) = 0 then array['服务体验真实', '流程清晰', '适合本地用户', '现场体验感强']
    else selling_points
  end,
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
  service_keywords = case
    when cardinality(service_keywords) = 0 then array['服务体验', '流程清晰', '新手友好', '省心']
    else service_keywords
  end,
  feature_keywords = case
    when cardinality(feature_keywords) = 0 then array['服务耐心', '环境舒适', '安排清楚', '真实体验']
    else feature_keywords
  end,
  length_options = case
    when cardinality(length_options) = 0 then array['简短自然', '详细一点', '种草感强']
    else length_options
  end,
  prompt_profile = coalesce(nullif(prompt_profile, ''), '用真实顾客体验口吻生成内容，避免夸大承诺，不要直接说发布到哪个平台。')
好了，痛不了
where status = 'active' or status is null;
