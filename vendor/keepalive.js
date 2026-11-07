/*
 * BirdCloud 防暂停探活（keepalive）
 *
 * 作用：打开页面时自动向 Supabase 发一次轻量请求，
 * 配合 UptimeRobot 每 5 分钟访问页面，双保险防止
 * Supabase 免费项目因长期无请求被闲置暂停。
 *
 * 说明：
 *  - 使用 publishable key 即可发起 REST 请求（RLS 正常生效，
 *    未登录返回空集也算活跃请求，不影响业务）。
 *  - 静默运行：探活失败不弹窗、不打扰用户。
 */
(function () {
    var URL = "https://ljgnwfswcqrzbetshocz.supabase.co";
    var KEY = "sb_publishable_wxkURA_31W9WNHZkj-RJzg_WaVoLszA";

    function ping() {
        try {
            fetch(URL + "/rest/v1/records?select=id&limit=1", {
                method: "GET",
                headers: {
                    "apikey": KEY,
                    "Authorization": "Bearer " + KEY
                }
            }).catch(function () { });
        } catch (e) { }
    }

    if (document.readyState === "complete" || document.readyState === "interactive") {
        ping();
    } else {
        window.addEventListener("load", ping);
    }
})();
