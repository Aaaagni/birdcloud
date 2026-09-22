-- =============================================================
-- BirdCloud 观鸟记录私有化 SQL（已执行完成 ✅）
-- 已通过 Supabase Management API 在项目 ljgnwfswcqrzbetshocz 执行，
-- 本文件保留为变更记录，可随时重新执行（全部幂等）。
--
-- 内容：观鸟记录本（records 表）按登录账号隔离 + 相册存储桶权限加固
-- =============================================================

-- ---------- 0. 清理相册桶旧策略（原有 3 条宽松策略） ----------
drop policy if exists "private-own-select" on storage.objects;
drop policy if exists "private-own-insert" on storage.objects;
drop policy if exists "private-own-delete" on storage.objects;

-- ---------- 1. 创建记录表（观鸟记录本，云端存储） ----------
create table if not exists public.records (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    name text not null,                     -- 鸟种名称
    place text not null default '未填写',    -- 观测地点
    date text not null,                     -- 观测日期（YYYY-MM-DD）
    note text not null default '',          -- 备注
    photo text not null default '',         -- 照片路径（bird-gallery 桶内）
    created_at timestamptz not null default now()
);

-- ---------- 2. 记录表行级安全（RLS）：只能操作自己的记录 ----------
alter table public.records enable row level security;

drop policy if exists "records_select_own" on public.records;
create policy "records_select_own" on public.records
    for select using (auth.uid() = user_id);

drop policy if exists "records_insert_own" on public.records;
create policy "records_insert_own" on public.records
    for insert with check (auth.uid() = user_id);

drop policy if exists "records_update_own" on public.records;
create policy "records_update_own" on public.records
    for update using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

drop policy if exists "records_delete_own" on public.records;
create policy "records_delete_own" on public.records
    for delete using (auth.uid() = user_id);

-- ---------- 3. 相册存储桶权限加固 ----------
-- 照片路径格式为 {用户ID}/{文件名}，此策略保证：
--   每个登录用户只能读取/上传/更新/删除自己文件夹下的文件
create policy "gallery_select_own" on storage.objects
    for select using (
        bucket_id = 'bird-gallery'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

create policy "gallery_insert_own" on storage.objects
    for insert with check (
        bucket_id = 'bird-gallery'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

create policy "gallery_update_own" on storage.objects
    for update using (
        bucket_id = 'bird-gallery'
        and (storage.foldername(name))[1] = auth.uid()::text
    ) with check (
        bucket_id = 'bird-gallery'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

create policy "gallery_delete_own" on storage.objects
    for delete using (
        bucket_id = 'bird-gallery'
        and (storage.foldername(name))[1] = auth.uid()::text
    );
