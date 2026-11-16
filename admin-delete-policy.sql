-- ============================================================
-- 管理员删除权限
--   1878646255@qq.com 可以删除「公共相册」里的任意照片
--   其他登录用户仍然只能删除自己发布的照片
--
-- 用法：Supabase 控制台 → SQL Editor → 粘贴整个文件 → Run
-- 可重复执行（先 drop 再 create）
-- ============================================================

-- 1) 照片记录：本人可删；管理员可删公共相册里的任意记录
drop policy if exists "photos_delete" on public.photos;
create policy "photos_delete" on public.photos
    for delete using (
        auth.uid() = user_id
        or (
            bucket = 'public'
            and lower(coalesce(auth.jwt() ->> 'email', '')) = '1878646255@qq.com'
        )
    );

-- 2) 存储文件：本人目录可删；管理员可删公共桶里的任意文件
drop policy if exists "public_own_delete" on storage.objects;
create policy "public_own_delete" on storage.objects
    for delete using (
        bucket_id = 'bird-public'
        and (
            (storage.foldername(name))[1] = auth.uid()::text
            or lower(coalesce(auth.jwt() ->> 'email', '')) = '1878646255@qq.com'
        )
    );

-- 3) 执行后应看到两条策略（photos_delete / public_own_delete）
select policyname, cmd, qual
from pg_policies
where (schemaname = 'public' and tablename = 'photos')
   or (schemaname = 'storage' and tablename = 'objects')
order by tablename, policyname;
