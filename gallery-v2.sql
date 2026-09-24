-- =============================================================
-- BirdCloud 观鸟相册 v2（最终生效版）：公共相册 + 私有相册 + 图片备注
-- 前置：v1 的私有桶 bird-gallery 已存在（schema.sql 已执行）
-- 执行方式：在 Supabase 控制台 -> SQL Editor 中执行（全部幂等，可重复执行）
-- 内容：
--   1. 创建公共存储桶 bird-public（公开读，路径 {用户ID}/{文件名}）
--   2. 公共桶写入策略：登录用户只能操作自己文件夹
--   3. 照片元数据表 photos（公共/私有 + 地点 + 日期 + 发布者名字）
--   4. 表级 RLS：公共记录所有人可看；私有记录仅本人；只能删自己的
--
-- 修复说明（本文件为最终落地版本）：
--   - 策略统一使用 auth.uid()（与 v1 的 records 表、bird-gallery 桶
--     已验证可用的写法一致），实测运行正常。
--   - 曾尝试 current_setting('request.jwt.claim.sub', true) 写法，
--     但运行时取不到用户 ID，导致 photos 写入与公共桶上传被 RLS 拒绝，
--     已全部改回 auth.uid()。
--   - photos.user_id 不 references auth.users，避免外键依赖；
--     如需级联删除，可后续自行补外键。
-- =============================================================

-- ---------- 1. 公共存储桶 bird-public（公开读，上限 10MB，图片类型） ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'bird-public',
    'bird-public',
    true,
    10485760,
    array['image/jpeg','image/png','image/webp','image/gif','image/heic']
)
on conflict (id) do update set public = true;

-- ---------- 2. 公共桶写入策略：登录用户只能上传/更新/删除自己文件夹 ----------
drop policy if exists "public_own_insert" on storage.objects;
create policy "public_own_insert" on storage.objects
    for insert with check (
        bucket_id = 'bird-public'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

drop policy if exists "public_own_update" on storage.objects;
create policy "public_own_update" on storage.objects
    for update using (
        bucket_id = 'bird-public'
        and (storage.foldername(name))[1] = auth.uid()::text
    )
    with check (
        bucket_id = 'bird-public'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

drop policy if exists "public_own_delete" on storage.objects;
create policy "public_own_delete" on storage.objects
    for delete using (
        bucket_id = 'bird-public'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

-- ---------- 3. 照片元数据表 photos ----------
-- bucket: public（公共相册）/ private（我的私有相册）
-- path:   {用户ID}/{文件名}，公共桶用公开 URL 读取，私有桶用签名 URL 读取
create table if not exists public.photos (
    id uuid primary key default gen_random_uuid(),
    bucket text not null check (bucket in ('public', 'private')),
    path text not null,
    user_id uuid not null,               -- 不依赖 auth.users 外键
    author_name text not null default '',   -- 发布者名字
    place text not null default '',         -- 观测地点
    taken_at text not null default '',      -- 观测日期（YYYY-MM-DD）
    created_at timestamptz not null default now()
);

create index if not exists photos_bucket_created_idx
    on public.photos (bucket, created_at desc);

create index if not exists photos_user_idx
    on public.photos (user_id);

-- ---------- 4. 表级安全（RLS） ----------
-- 查询：公共记录所有人可见（含未登录）；私有记录仅本人
-- 写入/删除/更新：仅本人
alter table public.photos enable row level security;

drop policy if exists "photos_select" on public.photos;
create policy "photos_select" on public.photos
    for select using (
        bucket = 'public'
        or (bucket = 'private' and auth.uid() = user_id)
    );

drop policy if exists "photos_insert" on public.photos;
create policy "photos_insert" on public.photos
    for insert with check (auth.uid() = user_id);

drop policy if exists "photos_update" on public.photos;
create policy "photos_update" on public.photos
    for update using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

drop policy if exists "photos_delete" on public.photos;
create policy "photos_delete" on public.photos
    for delete using (auth.uid() = user_id);
