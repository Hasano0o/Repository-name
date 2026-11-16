var Base64 = {
    _keyStr: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",
    encode: function(e) {
        var t = "";
        var n, r, i, s, o, u, a;
        var f = 0;
        e = Base64._utf8_encode(e);

        while (f < e.length) {
            n = e.charCodeAt(f++);
            r = e.charCodeAt(f++);
            i = e.charCodeAt(f++);
            s = n >> 2;
            o = (n & 3) << 4 | r >> 4;
            u = (r & 15) << 2 | i >> 6;
            a = i & 63;
            if (isNaN(r)) {
                u = a = 64
            } else if (isNaN(i)) {
                a = 64
            }
            t = t + this._keyStr.charAt(s) + this._keyStr.charAt(o) + this._keyStr.charAt(u) + this._keyStr.charAt(a)
        }
        return t
    },
    decode: function(e) {
        var t = "";
        var n, r, i;
        var s, o, u, a;
        var f = 0;
        e = e.replace(/[^A-Za-z0-9+/=]/g, "");
        while (f < e.length) {
            s = this._keyStr.indexOf(e.charAt(f++));
            o = this._keyStr.indexOf(e.charAt(f++));
            u = this._keyStr.indexOf(e.charAt(f++));
            a = this._keyStr.indexOf(e.charAt(f++));
            n = s << 2 | o >> 4;
            r = (o & 15) << 4 | u >> 2;
            i = (u & 3) << 6 | a;
            t = t + String.fromCharCode(n);
            if (u != 64) {
                t = t + String.fromCharCode(r)
            }
            if (a != 64) {
                t = t + String.fromCharCode(i)
            }
        }
        t = Base64._utf8_decode(t);
        return t
    },
    _utf8_encode: function(e) {
        //e = e.replace(/rn/g, "n");
        var t = "";
        for (var n = 0; n < e.length; n++) {
            var r = e.charCodeAt(n);
            if (r < 128) {
                t += String.fromCharCode(r)
            } else if (r > 127 && r < 2048) {
                t += String.fromCharCode(r >> 6 | 192);
                t += String.fromCharCode(r & 63 | 128)
            } else {
                t += String.fromCharCode(r >> 12 | 224);
                t += String.fromCharCode(r >> 6 & 63 | 128);
                t += String.fromCharCode(r & 63 | 128)
            }
        }
        return t
    },
    _utf8_decode: function(e) {
        var t = "";
        var n = 0;
        var r = c1 = c2 = 0;
        while (n < e.length) {
            r = e.charCodeAt(n);
            if (r < 128) {
                t += String.fromCharCode(r);
                n++
            } else if (r > 191 && r < 224) {
                c2 = e.charCodeAt(n + 1);
                t += String.fromCharCode((r & 31) << 6 | c2 & 63);
                n += 2
            } else {
                c2 = e.charCodeAt(n + 1);
                c3 = e.charCodeAt(n + 2);
                t += String.fromCharCode((r & 15) << 12 | (c2 & 63) << 6 | c3 & 63);
                n += 3
            }
        }
        return t
    }
};

String.prototype.replaceCharAt = function(n,c){
    return this.substr(0, n)+ c + this.substr(n+1,this.length-1-n);
}
function password_encode(password,secret,timestamp,timestamp_start){
    var charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    var date = new Date();
    var endTime = parseInt(date.getTime()/1000);
    var time_stamp = (parseInt("0x"+timestamp,16) + (endTime-timestamp_start)).toString(16);
    var message = time_stamp + ":" + password;
    var base64Str = Base64.encode(message);
    var parse16 = parseInt("0x"+secret,16);
    var first = charset[base64Str.length % charset.length];
    var tmp = "";
    for(var i = 0; i < 4; i++) {
        tmp += charset[((parse16 >> (i*8))& 0xff) % charset.length];
    }
    tmp += base64Str;
    base64Str = tmp;
    for(var i = 0; i < 4; i++) {
        var num = ((parse16 >> (i*8))& 0xff) % base64Str.length;
        var chr = base64Str.substr(num,1);
        var chrtotal = base64Str.substr(i % base64Str.length,1);
        base64Str = base64Str.replaceCharAt(num,chrtotal).replaceCharAt(i % base64Str.length,chr);
    }
    base64Str = first + base64Str;
    return base64Str;
}

function password_decode(str,secret){
    var parse16 = parseInt("0x"+secret,16);
    str = str.slice(1);
    for(var i = 4-1; i >= 0; i--) {
        var num = ((parse16 >> (i*8))& 0xff) % str.length;
        var chr = str.substr(num,1);
        var chrtotal = str.substr(i % str.length,1);
        str = str.replaceCharAt(num,chrtotal).replaceCharAt(i % str.length,chr);
    }
    var password = Base64.decode(str.slice(4));
    return password;
}