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

function parseJwtActor(raw) {
  if (!raw) {
    return '';
  }
  try {
    var segment = raw;
    if (raw.indexOf('.') !== -1) {
      var parts = raw.split('.');
      if (parts.length >= 2) {
        segment = parts[1];
      }
    }
    var json = decodeBase64Url(segment);
    var payload = JSON.parse(json);
    if (payload && typeof payload === 'object') {
      return (
        payload.usr ||
        payload.preferred_username ||
        payload.sub ||
        payload.email ||
        payload.name ||
        ''
      );
    }
  } catch (e) {
    return '';
  }
  return '';
}

function extractActor(r) {
  var forwarded =
    r.headersIn['X-Forwarded-User'] ||
    r.headersIn['X-Auth-Request-Preferred-Username'] ||
    r.headersIn['X-Auth-Request-User'];
  if (forwarded) {
    return forwarded;
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
    r.headersIn['X-Forwarded-User'] ||
    r.headersIn['X-Auth-Request-Preferred-Username'] ||
    r.headersIn['X-Auth-Request-User'] ||
    r.headersIn.Authorization
  ) {
    return '1';
  }
  var jwtCookie = getCookie(r.headersIn.Cookie, 'jwtPayload');
  if (jwtCookie && jwtCookie.length > 0) {
    return '1';
  }
  return '0';
}

export default { extractActor, isAuthenticated };
