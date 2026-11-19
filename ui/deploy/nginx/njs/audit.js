import fs from 'fs';
import qs from 'querystring';

var NO_WORKSPACE_SENTINEL = '__no_workspace_assigned__';
var WORKSPACE_MAP_PATH = '/tmp/workspace-map.json';

function getCookie(cookieHeader, name) {
  if (!cookieHeader) {
    return '';
  }
  var parts = cookieHeader.split(';');
  var prefix = name + '=';
  for (var i = 0; i < parts.length; i++) {
    var item = parts[i].trim();
    if (item.indexOf(prefix) === 0) {
      return item.slice(prefix.length);
    }
  }
  return '';
}

function decodeBase64Url(input) {
  var b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  var pad = b64.length % 4;
  if (pad === 2) {
    b64 += '==';
  } else if (pad === 3) {
    b64 += '=';
  }
  return Buffer.from(b64, 'base64').toString('utf8');
}

function parseJwtClaims(raw) {
  if (!raw) {
    return null;
  }
  try {
    var cleaned = decodeURIComponent(raw).replace(/^"|"$/g, '');
    var segment = cleaned;
    if (cleaned.indexOf('.') !== -1) {
      var parts = cleaned.split('.');
      if (parts.length >= 2) {
        segment = parts[1];
      }
    }
    var json = decodeBase64Url(segment);
    var payload = JSON.parse(json);
    if (payload && typeof payload === 'object') {
      return payload;
    }
  } catch (_e) {
    return null;
  }
  return null;
}

function parseJwtActor(raw) {
  var payload = parseJwtClaims(raw);
  if (!payload) {
    return '';
  }
  return (
    payload.usr ||
    payload.preferred_username ||
    payload.username ||
    payload.sub ||
    payload.email ||
    payload.name ||
    ''
  );
}

function isTrustedProxy(r) {
  return r && r.variables && r.variables.trusted_proxy === '1';
}

function extractActor(r) {
  if (isTrustedProxy(r)) {
    var forwarded =
      r.headersIn['X-Forwarded-User'] ||
      r.headersIn['X-Auth-Request-Preferred-Username'] ||
      r.headersIn['X-Auth-Request-User'];
    if (forwarded) {
      return forwarded;
    }
  }

  var jwtCookie = getCookie(r.headersIn.Cookie, 'jwtPayload');
  var actor = parseJwtActor(jwtCookie);
  if (actor) {
    return actor;
  }

  var authHeader = r.headersIn.Authorization || '';
  if (authHeader.indexOf('Bearer ') === 0) {
    var bearerActor = parseJwtActor(authHeader.slice(7).trim());
    if (bearerActor) {
      return bearerActor;
    }
    return 'bearer-token';
  }

  return 'anonymous';
}

function isAuthenticated(r) {
  if (
    isTrustedProxy(r) &&
    (r.headersIn['X-Forwarded-User'] ||
      r.headersIn['X-Auth-Request-Preferred-Username'] ||
      r.headersIn['X-Auth-Request-User'])
  ) {
    return '1';
  }
  if (r.headersIn.Authorization) {
    return '1';
  }
  var jwtCookie = getCookie(r.headersIn.Cookie, 'jwtPayload');
  if (jwtCookie && jwtCookie.length > 0) {
    return '1';
  }
  return '0';
}

function normalizeIdentity(val) {
  return String(val || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function isIdenticalTokenNameMatch(memberName, rawUserLower) {
  if (!rawUserLower || !memberName) {
    return false;
  }
  var parts = String(memberName).trim().toLowerCase().split(/\s+/);
  var tokens = [];
  for (var i = 0; i < parts.length; i++) {
    if (parts[i]) {
      tokens.push(parts[i]);
    }
  }
  if (tokens.length === 0) {
    return false;
  }
  for (var j = 0; j < tokens.length; j++) {
    if (tokens[j] !== rawUserLower) {
      return false;
    }
  }
  return true;
}

function resolveAllowedNamespaces(workspaceMap, username, subjectOrList) {
  var items = (workspaceMap && workspaceMap.data && workspaceMap.data.items) || [];
  var rawUserLower = String(username || '').trim().toLowerCase();
  var rawList = Array.isArray(subjectOrList) ? subjectOrList : subjectOrList ? [subjectOrList] : [];
  var subLowers = [];
  var subSeen = {};
  var normCandidates = [];
  var normSeen = {};
  var normUser = normalizeIdentity(username);
  if (normUser) {
    normSeen[normUser] = true;
    normCandidates.push(normUser);
  }
  for (var sIdx = 0; sIdx < rawList.length; sIdx++) {
    var sRaw = String(rawList[sIdx] || '').trim();
    var sLow = sRaw.toLowerCase();
    if (sLow && !subSeen[sLow]) {
      subSeen[sLow] = true;
      subLowers.push(sLow);
    }
    var sNorm = normalizeIdentity(sRaw);
    if (sNorm && !normSeen[sNorm]) {
      normSeen[sNorm] = true;
      normCandidates.push(sNorm);
    }
  }

  var out = [];
  var seen = {};

  for (var i = 0; i < items.length; i++) {
    var item = items[i] || {};
    var meta = item.metadata || {};
    var spec = item.spec || {};
    var status = item.status || {};
    var labels = meta.labels || {};
    var labelKeys = Object.keys(labels);
    var nsLabel = '';
    for (var nlIdx = 0; nlIdx < labelKeys.length; nlIdx++) {
      if (labelKeys[nlIdx].endsWith('/namespace')) {
        nsLabel = String(labels[labelKeys[nlIdx]] || '').trim();
        break;
      }
    }
    var ns = String(
      spec.namespace ||
        (status.namespaceRef && status.namespaceRef.name) ||
        nsLabel ||
        meta.name ||
        '',
    ).trim();
    if (!ns) {
      continue;
    }
    var hasLabelMatch = false;
    for (var j = 0; j < labelKeys.length; j++) {
      var lk = labelKeys[j];
      if (labels[lk] !== 'true') {
        continue;
      }
      var lowerK = lk.toLowerCase();
      if (rawUserLower && lowerK.endsWith('/' + rawUserLower)) {
        hasLabelMatch = true;
        break;
      }
      for (var sl = 0; sl < subLowers.length; sl++) {
        if (lowerK.endsWith('/' + subLowers[sl])) {
          hasLabelMatch = true;
          break;
        }
      }
      if (hasLabelMatch) {
        break;
      }
    }

    var members = spec.members || [];
    var hasMemberMatch = false;
    for (var mIdx = 0; mIdx < members.length; mIdx++) {
      var m = members[mIdx] || {};
      if (m.serviceAccount) {
        continue;
      }
      var mSub = String(m.subject || '').trim().toLowerCase();
      var mNameLower = String(m.name || '').trim().toLowerCase();
      var mNorm = normalizeIdentity(m.name);
      if (mSub && subLowers.indexOf(mSub) !== -1) {
        hasMemberMatch = true;
        break;
      }
      if (rawUserLower && (mSub === rawUserLower || mNameLower === rawUserLower)) {
        hasMemberMatch = true;
        break;
      }
      if (mNameLower && subLowers.indexOf(mNameLower) !== -1) {
        hasMemberMatch = true;
        break;
      }
      if (mNorm && normCandidates.indexOf(mNorm) !== -1) {
        hasMemberMatch = true;
        break;
      }
      if (isIdenticalTokenNameMatch(m.name, rawUserLower)) {
        hasMemberMatch = true;
        break;
      }
    }

    if ((hasLabelMatch || hasMemberMatch) && !seen[ns]) {
      seen[ns] = true;
      out.push(ns);
    }
  }

  return out.length > 0 ? out : [NO_WORKSPACE_SENTINEL];
}

function isAdminPermissions(permsMap) {
  if (!permsMap || typeof permsMap !== 'object') {
    return false;
  }
  var globalPerms = permsMap['*'];
  if (!Array.isArray(globalPerms)) {
    return false;
  }
  for (var i = 0; i < globalPerms.length; i++) {
    var entry = globalPerms[i] || {};
    var scopes = entry.scopes || [];
    var actions = entry.actions || [];
    var hasGlobalVarScope = scopes.indexOf('*') !== -1 || scopes.indexOf('GlobalVariable') !== -1;
    var hasWriteAction =
      actions.indexOf('*') !== -1 ||
      actions.indexOf('create') !== -1 ||
      actions.indexOf('update') !== -1;
    if (hasGlobalVarScope && hasWriteAction) {
      return true;
    }
  }
  return false;
}

function escapeRegexLiteral(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitFirstUnquotedPipe(query) {
  var trimmed = String(query || '').trim();
  var inSingle = false;
  var inDouble = false;
  var escaped = false;
  for (var i = 0; i < trimmed.length; i++) {
    var ch = trimmed[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === '|' && !inSingle && !inDouble) {
      return {
        filterPart: trimmed.slice(0, i).trim(),
        pipePart: trimmed.slice(i).trim(),
      };
    }
  }
  return { filterPart: trimmed, pipePart: '' };
}

function injectLogsQLNamespaceFilter(query, namespaces) {
  var nsList = namespaces && namespaces.length > 0 ? namespaces : [NO_WORKSPACE_SENTINEL];
  var nsRegex = nsList.map(escapeRegexLiteral).join('|');
  var nsFilter = 'kubernetes.pod_namespace:~"^(' + nsRegex + ')$"';
  var split = splitFirstUnquotedPipe(query);
  var filterPart = split.filterPart;
  var pipePart = split.pipePart;
  var scopedFilter =
    !filterPart || filterPart === '*' ? nsFilter : '(' + filterPart + ') AND ' + nsFilter;
  return pipePart ? scopedFilter + ' ' + pipePart : scopedFilter;
}

var PROMQL_RESERVED = {
  by: 1, without: 1, on: 1, ignoring: 1, group_left: 1, group_right: 1,
  bool: 1, and: 1, or: 1, unless: 1, offset: 1, atan2: 1,
  sum: 1, min: 1, max: 1, avg: 1, group: 1, stddev: 1, stdvar: 1, count: 1,
  count_values: 1, bottomk: 1, topk: 1, quantile: 1, limitk: 1, limit_ratio: 1,
  rate: 1, irate: 1, increase: 1, delta: 1, idelta: 1, deriv: 1, predict_linear: 1,
  histogram_quantile: 1, label_replace: 1, label_join: 1, vector: 1, scalar: 1,
  time: 1, absent: 1, absent_over_time: 1, changes: 1, resets: 1, sort: 1, sort_desc: 1,
  clamp: 1, clamp_min: 1, clamp_max: 1, round: 1, floor: 1, ceil: 1, abs: 1, sgn: 1,
  exp: 1, ln: 1, log2: 1, log10: 1, sqrt: 1, avg_over_time: 1, min_over_time: 1,
  max_over_time: 1, sum_over_time: 1, count_over_time: 1, quantile_over_time: 1,
  stddev_over_time: 1, stdvar_over_time: 1, last_over_time: 1, present_over_time: 1,
};

var PROMQL_LABEL_LIST_MODIFIERS = {
  by: 1, without: 1, on: 1, ignoring: 1, group_left: 1, group_right: 1,
};

function readBalancedQuoted(str, start) {
  var quote = str[start];
  var i = start + 1;
  while (i < str.length) {
    if (str[i] === '\\' && quote !== '`') {
      i += 2;
      continue;
    }
    if (str[i] === quote) {
      return i + 1;
    }
    i++;
  }
  return str.length;
}

function hasExactMatcher(inner, matcher) {
  var i = 0;
  var depthQuote = null;
  while (i < inner.length) {
    var ch = inner[i];
    if (depthQuote) {
      if (ch === '\\' && depthQuote !== '`') {
        i += 2;
        continue;
      }
      if (ch === depthQuote) depthQuote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      depthQuote = ch;
      i++;
      continue;
    }
    if (inner.slice(i, i + matcher.length) === matcher) {
      var prevOk = i === 0 || /[\s,{]/.test(inner[i - 1]);
      var nextIdx = i + matcher.length;
      var nextOk = nextIdx === inner.length || /[\s,}]/.test(inner[nextIdx]);
      if (prevOk && nextOk) return true;
    }
    i++;
  }
  return false;
}

function injectPromQLNamespaceFilter(promql, namespaces) {
  var trimmed = String(promql || '').trim();
  if (!trimmed) {
    return trimmed;
  }
  var nsList = namespaces && namespaces.length > 0 ? namespaces : [NO_WORKSPACE_SENTINEL];
  var matcher =
    nsList.length === 1
      ? 'namespace="' + nsList[0].replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
      : 'namespace=~"^(' + nsList.map(escapeRegexLiteral).join('|') + ')$"';

  var out = '';
  var i = 0;
  var len = trimmed.length;
  var expectLabelListParen = false;

  while (i < len) {
    var ch = trimmed[i];

    if (ch === '"' || ch === "'" || ch === '`') {
      var qEnd = readBalancedQuoted(trimmed, i);
      out += trimmed.slice(i, qEnd);
      i = qEnd;
      expectLabelListParen = false;
      continue;
    }

    if (ch === '#') {
      var nl = trimmed.indexOf('\n', i);
      var cEnd = nl === -1 ? len : nl + 1;
      out += trimmed.slice(i, cEnd);
      i = cEnd;
      continue;
    }

    if (/\s/.test(ch)) {
      out += ch;
      i++;
      continue;
    }

    if (ch === '(' && expectLabelListParen) {
      var depth = 1;
      var j = i + 1;
      while (j < len && depth > 0) {
        if (trimmed[j] === '"' || trimmed[j] === "'" || trimmed[j] === '`') {
          j = readBalancedQuoted(trimmed, j);
          continue;
        }
        if (trimmed[j] === '(') depth++;
        else if (trimmed[j] === ')') depth--;
        j++;
      }
      out += trimmed.slice(i, j);
      i = j;
      expectLabelListParen = false;
      continue;
    }
    expectLabelListParen = false;

    if (ch === '[') {
      var close = trimmed.indexOf(']', i + 1);
      var bEnd = close === -1 ? len : close + 1;
      out += trimmed.slice(i, bEnd);
      i = bEnd;
      continue;
    }

    if (ch === '{') {
      var sIdx = i + 1;
      while (sIdx < len && trimmed[sIdx] !== '}') {
        if (trimmed[sIdx] === '"' || trimmed[sIdx] === "'" || trimmed[sIdx] === '`') {
          sIdx = readBalancedQuoted(trimmed, sIdx);
          continue;
        }
        sIdx++;
      }
      var hasClose = sIdx < len && trimmed[sIdx] === '}';
      var inner = trimmed.slice(i + 1, sIdx);
      if (hasExactMatcher(inner, matcher)) {
        out += trimmed.slice(i, hasClose ? sIdx + 1 : sIdx);
      } else {
        var cleanInner = inner.trim().replace(/,\s*$/, '');
        out += cleanInner ? '{' + cleanInner + ',' + matcher + '}' : '{' + matcher + '}';
      }
      i = hasClose ? sIdx + 1 : sIdx;
      continue;
    }

    if (/[a-zA-Z_:]/.test(ch)) {
      var idStart = i;
      while (i < len && /[a-zA-Z0-9_:]/.test(trimmed[i])) i++;
      var ident = trimmed.slice(idStart, i);
      var lower = ident.toLowerCase();

      if (PROMQL_LABEL_LIST_MODIFIERS[lower]) {
        out += ident;
        expectLabelListParen = true;
        continue;
      }

      if (PROMQL_RESERVED[lower]) {
        out += ident;
        continue;
      }

      var k = i;
      while (k < len && /\s/.test(trimmed[k])) k++;
      if (trimmed[k] === '(' || trimmed[k] === '{') {
        out += ident;
        continue;
      }

      out += ident + '{' + matcher + '}';
      continue;
    }

    if (/[0-9]/.test(ch)) {
      var nStart = i;
      while (i < len && /[0-9a-fA-FxXeE._]/.test(trimmed[i])) i++;
      while (i < len && /[a-zA-Z0-9]/.test(trimmed[i])) i++;
      out += trimmed.slice(nStart, i);
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

function appendParam(params, key, val) {
  if (params[key] === undefined) {
    params[key] = val;
  } else if (Array.isArray(params[key])) {
    params[key].push(val);
  } else {
    params[key] = [params[key], val];
  }
}

function rewriteProxyTarget(uri, method, body, allowedNamespaces) {
  var qIdx = uri.indexOf('?');
  var path = qIdx === -1 ? uri : uri.slice(0, qIdx);
  var rawQuery = qIdx === -1 ? '' : uri.slice(qIdx + 1);
  var params = rawQuery ? qs.parse(rawQuery) : {};
  var nsList = allowedNamespaces && allowedNamespaces.length > 0 ? allowedNamespaces : [NO_WORKSPACE_SENTINEL];

  var isVictoriaLogs =
    path.indexOf('/select/logsql/query_range') !== -1 ||
    path.indexOf('/select/logsql/query') !== -1 ||
    path.indexOf('/select/logsql/hits') !== -1 ||
    path.indexOf('/select/logsql/stats_query_range') !== -1 ||
    path.indexOf('/select/logsql/stats_query') !== -1 ||
    path.indexOf('/select/logsql/field_values') !== -1 ||
    path.indexOf('/select/logsql/field_names') !== -1 ||
    path.indexOf('/select/logsql/facets') !== -1;

  var isPrometheus =
    path.endsWith('/api/v1/query') ||
    path.endsWith('/api/v1/query_range') ||
    path.endsWith('/api/v1/series') ||
    path.endsWith('/api/v1/labels') ||
    path.indexOf('/api/v1/label/') !== -1;

  var isJaegerV2Traces = path.endsWith('/api/traces');
  var isJaegerV3Traces = path.endsWith('/api/v3/traces');
  var isTempoSearch = path.endsWith('/api/search');
  var isTraceServices = path.endsWith('/api/services') || path.endsWith('/api/v3/services');

  var nextBody = body;
  var bodyModified = false;

  if (isVictoriaLogs) {
    if (params.query !== undefined) {
      params.query = injectLogsQLNamespaceFilter(
        Array.isArray(params.query) ? params.query[0] : params.query,
        nsList,
      );
    }
    if (method === 'POST' && typeof body === 'string' && body.indexOf('query=') !== -1) {
      var vlBody = qs.parse(body);
      if (vlBody.query !== undefined) {
        vlBody.query = injectLogsQLNamespaceFilter(
          Array.isArray(vlBody.query) ? vlBody.query[0] : vlBody.query,
          nsList,
        );
        nextBody = qs.stringify(vlBody);
        bodyModified = true;
      }
    }
  }

  if (isPrometheus) {
    var promMatcher =
      nsList.length === 1
        ? 'namespace="' + nsList[0] + '"'
        : 'namespace=~"^(' + nsList.map(escapeRegexLiteral).join('|') + ')$"';
    var isLabelOrSeries =
      path.endsWith('/api/v1/series') ||
      path.endsWith('/api/v1/labels') ||
      path.indexOf('/api/v1/label/') !== -1;

    if (nsList.length === 1) {
      appendParam(params, 'extra_label', 'namespace=' + nsList[0]);
    }
    if (params.query !== undefined) {
      params.query = injectPromQLNamespaceFilter(
        Array.isArray(params.query) ? params.query[0] : params.query,
        nsList,
      );
    }
    if (params['match[]'] !== undefined) {
      var existingMatches = Array.isArray(params['match[]']) ? params['match[]'] : [params['match[]']];
      params['match[]'] = existingMatches.map(function (m) {
        return injectPromQLNamespaceFilter(m, nsList);
      });
    } else if (isLabelOrSeries && !(typeof body === 'string' && body.indexOf('match%5B%5D=') !== -1)) {
      params['match[]'] = '{' + promMatcher + '}';
    }

    if (method === 'POST' && typeof body === 'string' && (body.indexOf('query=') !== -1 || body.indexOf('match%5B%5D=') !== -1)) {
      var promBody = qs.parse(body);
      if (promBody.query !== undefined) {
        promBody.query = injectPromQLNamespaceFilter(
          Array.isArray(promBody.query) ? promBody.query[0] : promBody.query,
          nsList,
        );
        bodyModified = true;
      }
      if (promBody['match[]'] !== undefined) {
        var bMatches = Array.isArray(promBody['match[]']) ? promBody['match[]'] : [promBody['match[]']];
        promBody['match[]'] = bMatches.map(function (m) {
          return injectPromQLNamespaceFilter(m, nsList);
        });
        bodyModified = true;
      }
      if (bodyModified) {
        nextBody = qs.stringify(promBody);
      }
    }
  }

  if (isJaegerV2Traces && nsList.length === 1) {
    var tagMap = {};
    if (params.tags) {
      try {
        var parsedTags = JSON.parse(Array.isArray(params.tags) ? params.tags[0] : params.tags);
        if (parsedTags && typeof parsedTags === 'object' && !Array.isArray(parsedTags)) {
          tagMap = parsedTags;
        }
      } catch (_e) {
        tagMap = {};
      }
    }
    tagMap['k8s.namespace.name'] = nsList[0];
    params.tags = JSON.stringify(tagMap);
  }

  if (isJaegerV3Traces && nsList.length === 1) {
    params['query.attributes[k8s.namespace.name]'] = nsList[0];
  }

  if (isTempoSearch && nsList.length === 1) {
    var existingTempoTags = String(Array.isArray(params.tags) ? params.tags[0] : params.tags || '').trim();
    var escapedTempoNs = nsList[0].replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    var nsTag = 'k8s.namespace.name="' + escapedTempoNs + '"';
    params.tags = existingTempoTags ? existingTempoTags + ' ' + nsTag : nsTag;
  }

  if (isTraceServices && nsList.length === 1) {
    params.namespace = nsList[0];
  }

  var serialized = qs.stringify(params);
  var nextUri = serialized ? path + '?' + serialized : path;
  return {
    uri: nextUri,
    body: nextBody,
    bodyModified: bodyModified,
  };
}

function readWorkspaceMapSafe() {
  try {
    var raw = fs.readFileSync(WORKSPACE_MAP_PATH, 'utf8');
    var parsed = JSON.parse(raw);
    if (parsed && parsed.enabled) {
      return parsed;
    }
  } catch (_e) {
    return null;
  }
  return null;
}

function extractShareToken(r) {
  if (!r || !r.headersIn) {
    return '';
  }
  var token = r.headersIn['X-Perses-Share-Token'] || r.headersIn['x-perses-share-token'] || '';
  return String(token).trim();
}

function parseGlobalVariableJson(responseText) {
  if (!responseText) {
    return null;
  }
  try {
    var res = JSON.parse(responseText);
    var rawVal = '';
    if (res && res.spec && res.spec.kind === 'TextVariable' && res.spec.spec && typeof res.spec.spec.value === 'string') {
      rawVal = res.spec.spec.value;
    } else if (res && res.spec && res.spec.spec && typeof res.spec.spec.value === 'string') {
      rawVal = res.spec.spec.value;
    } else if (res && res.spec && res.spec.plugin && res.spec.plugin.spec && typeof res.spec.plugin.spec.value === 'string') {
      rawVal = res.spec.plugin.spec.value;
    }
    if (!rawVal) {
      return null;
    }
    return JSON.parse(rawVal);
  } catch (_e) {
    return null;
  }
}

function isGuestDashboardsAllowed(roleConfig) {
  if (!roleConfig || !roleConfig.roles || !Array.isArray(roleConfig.roles.guest)) {
    return false;
  }
  return roleConfig.roles.guest.indexOf('dashboards') !== -1;
}

function findMatchingPublicShare(sharesConfig, token) {
  if (!token || !sharesConfig || !Array.isArray(sharesConfig.shares)) {
    return null;
  }
  for (var i = 0; i < sharesConfig.shares.length; i++) {
    var item = sharesConfig.shares[i];
    if (
      item &&
      item.enabled !== false &&
      item.token === token &&
      typeof item.project === 'string' &&
      item.project.length > 0 &&
      typeof item.dashboard === 'string' &&
      item.dashboard.length > 0
    ) {
      return item;
    }
  }
  return null;
}

function isAllowedGuestApiPath(uri, method, share) {
  if (method !== 'GET' || !share) {
    return false;
  }
  var qIdx = uri.indexOf('?');
  var path = qIdx === -1 ? uri : uri.slice(0, qIdx);
  var encProj = encodeURIComponent(share.project);
  var encDash = encodeURIComponent(share.dashboard);

  // Never expose the share token registry itself to anonymous callers
  if (path === '/api/v1/globalvariables/perses_ui_public_shares') {
    return false;
  }

  if (
    path === '/api/v1/projects/' + encProj + '/dashboards/' + encDash ||
    path === '/api/v1/projects/' + share.project + '/dashboards/' + share.dashboard
  ) {
    return true;
  }

  if (
    path === '/api/v1/projects/' + encProj ||
    path === '/api/v1/projects/' + share.project ||
    path === '/api/v1/plugins' ||
    path === '/api/v1/globaldatasources' ||
    path.indexOf('/api/v1/globaldatasources/') === 0 ||
    path === '/api/v1/globalvariables' ||
    path.indexOf('/api/v1/globalvariables/') === 0 ||
    path === '/api/v1/projects/' + encProj + '/datasources' ||
    path.indexOf('/api/v1/projects/' + encProj + '/datasources/') === 0 ||
    path === '/api/v1/projects/' + share.project + '/datasources' ||
    path.indexOf('/api/v1/projects/' + share.project + '/datasources/') === 0 ||
    path === '/api/v1/projects/' + encProj + '/variables' ||
    path.indexOf('/api/v1/projects/' + encProj + '/variables/') === 0 ||
    path === '/api/v1/projects/' + share.project + '/variables' ||
    path.indexOf('/api/v1/projects/' + share.project + '/variables/') === 0
  ) {
    return true;
  }

  return false;
}

async function resolvePublicShare(r, shareToken) {
  if (!shareToken) {
    return null;
  }
  var roleRes = await r.subrequest('/_perses_internal/api/v1/globalvariables/role_view_permissions_config', {
    method: 'GET',
  });
  if (roleRes.status < 200 || roleRes.status >= 300) {
    return null;
  }
  var roleConfig = parseGlobalVariableJson(roleRes.responseText || '');
  if (!isGuestDashboardsAllowed(roleConfig)) {
    return null;
  }

  var sharesRes = await r.subrequest('/_perses_internal/api/v1/globalvariables/perses_ui_public_shares', {
    method: 'GET',
  });
  if (sharesRes.status < 200 || sharesRes.status >= 300) {
    return null;
  }
  var sharesConfig = parseGlobalVariableJson(sharesRes.responseText || '');
  return findMatchingPublicShare(sharesConfig, shareToken);
}

async function apiV1WithGuestShare(r) {
  if (isAuthenticated(r) === '1') {
    r.internalRedirect('/_perses_upstream' + r.variables.request_uri);
    return;
  }

  var shareToken = extractShareToken(r);
  if (!shareToken) {
    r.return(401, 'Unauthorized');
    return;
  }

  var share = await resolvePublicShare(r, shareToken);
  if (!share || !isAllowedGuestApiPath(r.variables.request_uri, r.method, share)) {
    r.return(403, 'Forbidden');
    return;
  }

  r.internalRedirect('/_perses_upstream' + r.variables.request_uri);
}

async function forwardWithNamespaces(r, allowedNamespaces) {
  var rewritten = rewriteProxyTarget(
    r.variables.request_uri,
    r.method,
    r.requestText || '',
    allowedNamespaces,
  );

  if (!rewritten.bodyModified) {
    r.internalRedirect('/_perses_upstream' + rewritten.uri);
    return;
  }

  var upstreamRes = await r.subrequest('/_perses_upstream' + rewritten.uri, {
    method: r.method,
    body: rewritten.body,
  });
  var contentType = upstreamRes.headersOut['Content-Type'];
  if (contentType) {
    r.headersOut['Content-Type'] = contentType;
  }
  r.return(upstreamRes.status, upstreamRes.responseBuffer);
}

async function proxyWithTenantScope(r) {
  if (isAuthenticated(r) !== '1') {
    var shareToken = extractShareToken(r);
    if (!shareToken) {
      r.return(401, 'Unauthorized');
      return;
    }
    if (r.method !== 'GET' && r.method !== 'POST') {
      r.return(403, 'Forbidden');
      return;
    }
    var share = await resolvePublicShare(r, shareToken);
    if (!share) {
      r.return(403, 'Forbidden');
      return;
    }
    var shareNs = Array.isArray(share.allowedNamespaces) ? share.allowedNamespaces : [];
    if (shareNs.indexOf('*') !== -1) {
      r.internalRedirect('/_perses_upstream' + r.variables.request_uri);
      return;
    }
    await forwardWithNamespaces(r, shareNs);
    return;
  }

  var workspaceMap = readWorkspaceMapSafe();
  if (!workspaceMap) {
    r.internalRedirect('/_perses_upstream' + r.variables.request_uri);
    return;
  }

  var actor = extractActor(r);
  if (!actor || actor === 'anonymous') {
    r.return(401, 'Unauthorized');
    return;
  }

  var permsRes = await r.subrequest(
    '/_perses_internal/api/v1/users/' + encodeURIComponent(actor) + '/permissions',
    { method: 'GET' },
  );
  if (permsRes.status === 401 || permsRes.status === 403) {
    r.return(401, 'Unauthorized');
    return;
  }

  if (permsRes.status >= 200 && permsRes.status < 300) {
    try {
      var perms = JSON.parse(permsRes.responseText || '{}');
      if (isAdminPermissions(perms)) {
        r.internalRedirect('/_perses_upstream' + r.variables.request_uri);
        return;
      }
    } catch (_e) {
      // Fall through to workspace enforcement if permissions cannot be parsed
    }
  }

  var jwtCookie = getCookie(r.headersIn.Cookie, 'jwtPayload');
  var claims = parseJwtClaims(jwtCookie);
  var subjects = [];
  if (claims && claims.sub) {
    subjects.push(claims.sub);
  }
  subjects.push(actor);

  var userRes = await r.subrequest(
    '/_perses_internal/api/v1/users/' + encodeURIComponent(actor),
    { method: 'GET' },
  );
  if (userRes.status >= 200 && userRes.status < 300) {
    try {
      var userObj = JSON.parse(userRes.responseText || '{}');
      var uSpec = (userObj && userObj.spec) || {};
      var oauthProviders = uSpec.oauthProviders || [];
      for (var opIdx = 0; opIdx < oauthProviders.length; opIdx++) {
        var op = oauthProviders[opIdx] || {};
        if (op.subject) subjects.push(op.subject);
        if (op.email) subjects.push(op.email);
      }
      var fn = [uSpec.firstName, uSpec.lastName].filter(Boolean).join(' ').trim();
      if (fn) subjects.push(fn);
    } catch (_e2) {
      // Ignore user parse errors
    }
  }

  var allowedNamespaces = resolveAllowedNamespaces(workspaceMap, actor, subjects);
  await forwardWithNamespaces(r, allowedNamespaces);
}

export default {
  extractActor,
  isAuthenticated,
  apiV1WithGuestShare,
  proxyWithTenantScope,
  isAdminPermissions,
  resolveAllowedNamespaces,
  rewriteProxyTarget,
  isGuestDashboardsAllowed,
  isAllowedGuestApiPath,
  findMatchingPublicShare,
};
