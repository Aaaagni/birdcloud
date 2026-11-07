-- =============================================================
-- BirdCloud 相册恢复修复 SQL（幂等，可重复执行）
-- 适用场景：Supabase 项目暂停/恢复后 Storage 存储桶元数据丢失，
--          公共相册（bird-public）与私有相册（bird-gallery）加载失败。
-- 执行方式：Supabase 控制台 -> SQL Editor -> New query -> 粘贴执行
-- 内容：
--   1. 重建公共存储桶 bird-public（公开读，10MB，图片类型）
--   2. 重建私有存储桶 bird-gallery（私有，10MB，图片类型）
--   3. 重建 bird-public 写入策略（登录用户只能操作自己文件夹）
--   4. 重建 bird-gallery 读写策略（登录用户只能操作自己文件夹）
--   5. 重建 photos 元数据表 RLS 策略（公共所有人可见；私有仅本人）
-- =============================================================

-- ---------- 1. 公共存储桶 bird-public（公开读） ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'bird-public',
    'bird-public',
    true,
    10485760,
    array['image/jpeg','image/png','image/webp','image/gif','image/heic']
)
on conflict (id) do update set public = true;

-- ---------- 2. 私有存储桶 bird-gallery（仅签名 URL 可读） ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'bird-gallery',
    'bird-gallery',
    false,
    10485760,
    array['image/jpeg','image/png','image/webp','image/gif','image/heic']
)
on conflict (id) do update set public = false;

-- ---------- 3. 公共桶写入策略：登录用户只能上传/更新/删除自己文件夹 ----------
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

-- ---------- 4. 私有桶读写策略：登录用户只能读/传/改/删自己文件夹 ----------
drop policy if exists "gallery_select_own" on storage.objects;
create policy "gallery_select_own" on storage.objects
    for select using (
        bucket_id = 'bird-gallery'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

drop policy if exists "gallery_insert_own" on storage.objects;
create policy "gallery_insert_own" on storage.objects
    for insert with check (
        bucket_id = 'bird-gallery'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

drop policy if exists "gallery_update_own" on storage.objects;
create policy "gallery_update_own" on storage.objects
    for update using (
        bucket_id = 'bird-gallery'
        and (storage.foldername(name))[1] = auth.uid()::text
    ) with check (
        bucket_id = 'bird-gallery'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

drop policy if exists "gallery_delete_own" on storage.objects;
create policy "gallery_delete_own" on storage.objects
    for delete using (
        bucket_id = 'bird-gallery'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

-- ---------- 5. photos 元数据表 RLS：公共所有人可见；私有仅本人 ----------
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
