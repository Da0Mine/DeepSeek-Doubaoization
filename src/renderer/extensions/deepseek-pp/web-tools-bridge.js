(function () {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    document.title = 'wb:NO_CHROME';
    return;
  }
  var KEY = 'deepseek_pp_web_tool_settings';
  var q = new URLSearchParams(location.search);
  var op = q.get('op');
  function done(v) { try { document.title = 'wb:' + String(v); } catch (e) {} }
  if (op === 'get') {
    chrome.storage.local.get(KEY).then(function (r) {
      var s = (r && r[KEY]) || {};
      done(s.web_search ? 'true' : 'false');
    }).catch(function (e) { done('ERR:' + (e && e.message ? e.message : String(e))); });
  } else if (op === 'set') {
    var on = q.get('on') === '1';
    var obj = {};
    obj[KEY] = { web_search: on, web_fetch: on };
    chrome.storage.local.set(obj).then(function () { done('true'); }).catch(function (e) { done('ERR:' + (e && e.message ? e.message : String(e))); });
  } else if (op === 'skill') {
    // 任务模式联动 skill 自动激活：同样走扩展上下文写存储 → chrome.storage.onChanged 广播到侧边栏，开关即时刷新
    var son = q.get('on') === '1';
    var SKILL_KEY = 'deepseek_pp_skill_auto_activation';
    var skillObj = {};
    skillObj[SKILL_KEY] = { firstMessage: son, everyMessage: son };
    chrome.storage.local.set(skillObj).then(function () { done('true'); }).catch(function (e) { done('ERR:' + (e && e.message ? e.message : String(e))); });
  } else if (op === 'mem') {
    // 普通模式「记忆功能」：写 deepseek_pp_prompt_injection_settings.memoryEnabled（读后再并，避免覆盖其它字段）
    var mon = q.get('on') === '1';
    var MKEY = 'deepseek_pp_prompt_injection_settings';
    chrome.storage.local.get(MKEY).then(function (r) {
      var cur = (r && r[MKEY]) || {};
      var obj = {};
      obj[MKEY] = { memoryEnabled: mon, systemPromptEnabled: true, presetCadence: 'default', forceResponseLanguage: 'auto' };
      chrome.storage.local.set(obj).then(function () { done('true'); }).catch(function (e) { done('ERR:' + (e && e.message ? e.message : String(e))); });
    }).catch(function (e) { done('ERR:' + (e && e.message ? e.message : String(e))); });
  } else if (op === 'sa') {
    // 任务模式「自动匹配skill」两个子项分别写入 skill 自动激活存储（首条/每条）
    var first = q.get('first') === '1';
    var every = q.get('every') === '1';
    var SKEY = 'deepseek_pp_skill_auto_activation';
    var sObj = {};
    sObj[SKEY] = { firstMessage: first, everyMessage: every };
    chrome.storage.local.set(sObj).then(function () { done('true'); }).catch(function (e) { done('ERR:' + (e && e.message ? e.message : String(e))); });
  } else if (op === 'saget') {
    // 读取 skill 自动激活真实存储（首条/每条），供页面展开框初始化同步：返回 "1,1" / "0,1" 等
    chrome.storage.local.get('deepseek_pp_skill_auto_activation').then(function (r) {
      var s = (r && r['deepseek_pp_skill_auto_activation']) || {};
      var first = s.firstMessage !== false ? '1' : '0';
      var every = s.everyMessage !== false ? '1' : '0'; // 未显式关闭即为开（默认两个都开）
      done(first + ',' + every);
    }).catch(function (e) { done('ERR:' + (e && e.message ? e.message : String(e))); });
  } else if (op === 'ws') {
    // 增强搜索展开框：分别写「搜索互联网(web_search) / 获取网页(web_fetch)」到网页工具存储（first→search, every→fetch）
    var wk = 'deepseek_pp_web_tool_settings';
    var wsObj = {};
    wsObj[wk] = { web_search: q.get('first') === '1', web_fetch: q.get('every') === '1' };
    chrome.storage.local.set(wsObj).then(function () { done('true'); }).catch(function (e) { done('ERR:' + (e && e.message ? e.message : String(e))); });
  } else if (op === 'wsget') {
    // 读取网页工具真实存储（web_search 在前 web_fetch 在后）：返回 "1,1"
    chrome.storage.local.get('deepseek_pp_web_tool_settings').then(function (r) {
      var s = (r && r['deepseek_pp_web_tool_settings']) || {};
      var search = s.web_search !== false ? '1' : '0'; // 未显式关闭即为开
      var fetch = s.web_fetch !== false ? '1' : '0';
      done(search + ',' + fetch);
    }).catch(function (e) { done('ERR:' + (e && e.message ? e.message : String(e))); });
  } else {
    done('noop');
  }
})();
