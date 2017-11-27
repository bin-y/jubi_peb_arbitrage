'use strict';

const util = require('util'),
    request = require('request'),
    verror = require('verror'),
    crypto = require('crypto');

module.exports = class {
    constructor(options) {
        this.key = options.key;
        if (options.secret)
            this.secret_md5 = crypto.createHash('md5').update(options.secret).digest('hex');

        this.peb_market = options.peb_market;

        var protocol = (options.use_https ? 'https' : 'http');
        this.public_api_url = protocol + '://www.jubi.com/api/v1/';
        this.web_api_url = protocol + '://www.jubi.com/coin/';
        this.web_api_user_agent = options.web_api_user_agent ? options.web_api_user_agent : "Mozilla/5.0 (Windows NT 10.0; WOW64; Trident/7.0; .NET4.0C; .NET4.0E; .NET CLR 2.0.50727; .NET CLR 3.0.30729; .NET CLR 3.5.30729; rv:11.0) like Gecko";
        this.keep_alive = options.keep_alive;
        // private requests forced to use https
        this.private_api_url = 'https://www.jubi.com/api/v1/';

        this.timeout = options.timeout ? options.timeout : 10000;
        this.coin_name = {
            ltc: '莱特币', skt: '鲨之信', vtc: '绿币', ifc: '无限币', tfc: '传送币', btc: '比特币', drk: '达世币', blk: '黑币', vrc: '维理币', jbc: '聚宝币', doge: '狗币', zcc: '招财币', xpm: '质数币', ppc: '点点币', wdc: '世界币', max: '最大币', zet: '泽塔币', eac: '地球币', fz: '冰河币', dnc: '安网币', xrp: '瑞波币', nxt: '未来币', gooc: '谷壳币', plc: '保罗币', mtc: '猴宝币', qec: '企鹅链', lkc: '幸运币', met: '美通币', lsk: 'LISK', ytc: '一号币', eth: '以太坊', etc: '以太经典', xas: '阿希币', hlb: '活力币', game: '游戏点', rss: '红贝壳', rio: '里约币', ktc: '肯特币', pgc: '乐园通', nhgh: '宁红柑红', ans: '小蚁股', peb: '普银', xsgs: '雪山古树', mryc: '美人鱼币', bts: '比特股', mcc: '行云币', ugt: 'UG Token', eos: 'EOS', tic: '钛币', ico: 'ICO币', bcc: 'BCC', btk: 'B-Token', qtum: '量子链', elc: '选举链', hcc: '医疗链', btm: '比原链', act: 'Achain', xnc: '玄链'
        };
    };

    executeRequest(options, requestDesc, callback, retry) {
        options.forever = this.keep_alive;
        var functionName = 'JUBI.executeRequest()';
        // options.proxy= 'http://127.0.0.1:8888'
        function callback_warpper(err, response, data) {
            var error = null;   // default to no errors
    
            if (err) {
                error = new verror(err, '%s failed %s', functionName, options.url);
                error.name = err.code;
            }
            else if (response.statusCode < 200 || response.statusCode >= 300) {
                error = new verror('%s HTTP status code %s returned from %s. Status message: %s', functionName,
                    response.statusCode, requestDesc, response.statusMessage);
                error.name = response.statusCode;
            }
            else {
                // if request was not able to parse json response into an object
                try {
                    data = JSON.parse(data);
                } catch (error) {
                }
    
                if (data.error) {
                    error = new verror('%s API returned error code %s from %s\nError message: %s', functionName,
                        data.error.code, requestDesc);
                    error.name = data.error.message;
                }
            }
    
            var result = callback(error, data);
            if (result && (result.retry || result.retry_after)) {
                if (result.retry_after) {
                    setTimeout(function () {
                        retry ? retry() : request(options, callback_warpper);
                    }, result.retry_after);
                }
                else {
                    retry ? retry() : request(options, callback_warpper);
                }
            }
        };
        request(options, callback_warpper);
    }
    
    publicRequest(method, params, callback, is_webapi) {
        const functionName = 'JUBI.publicRequest()';

        if (typeof (params) != 'object') {
            const error = new verror('%s second parameter %s must be an object. If no params then pass an empty object {}', functionName, params);
            return callback(error);
        }

        var url;
        var headers;
        if (is_webapi) {
            url = this.web_api_url + method;
            headers = { "User-Agent": this.web_api_user_agent };
        }
        else {
            url = this.public_api_url + method + (this.peb_market ? '/peb/1' : '');
        }

        var options = {
            url: url,
            method: 'GET',
            headers: headers,
            timeout: this.timeout,
            qs: params
        };
        this.executeRequest(options, url, callback)
    };


    privateRequest(method, params, callback) {
        const functionName = 'JUBI.privateRequest()';

        if (!this.key || !this.secret_md5) {
            const error = new verror('%s must provide key and secret to make this API request.', functionName);
            return callback(error);
        }

        if (typeof (params) != 'object') {
            const error = new verror('%s second parameter %s must be an object. If no params then pass an empty object {}', functionName, params);
            return callback(error);
        }

        if (!callback || typeof (callback) != 'function') {
            const error = new verror('%s third parameter needs to be a callback function', functionName);
            return callback(error);
        }

        const url = this.private_api_url + method + (this.peb_market ? '/peb/1' : '');
        var message_without_nonce = '&key=' + this.key;
        for (var param in params) {
            message_without_nonce += '&' + param + '=' + params[param];
        }

        var options = {
            url,
            method: 'POST',
        };
        var retry = function() {
            const nonce = Date.now();

            var message = "nonce=" + nonce + message_without_nonce;

            var hmac = crypto.createHmac('sha256', this.secret_md5);
            message += '&signature=' + hmac.update(message).digest('hex');
            options.form = message;

            this.executeRequest(options, url + JSON.stringify(params), callback, retry);
        }.bind(this);
        retry();
    };

    //
    // Public Functions
    //

    ticker(coin, callback) {
        this.publicRequest('ticker', { coin }, callback);
    };

    depth(coin, callback) {
        this.publicRequest('depth', { coin }, callback);
    };

    orders(coin, callback) {
        this.publicRequest('orders', { coin }, callback);
    };

    allTickers(callback) {
        this.publicRequest('allticker', {}, callback);
    };

    webDepth(coin, callback) {
        this.publicRequest(coin + (this.peb_market ? '/trades' : '/depth.js'), { t: Math.random() }, callback, true);
    };

    webKLine(coin, callback) {
        this.publicRequest(coin + (this.peb_market ? '/pebk.js' : '/k.js'), { t: Math.random() }, callback, true);
    };

    webAllCoin(callback) {
        this.publicRequest(this.peb_market ? 'peballcoin' : 'allcoin', { t: Math.random() }, callback, true);
    };

    webTrends(callback) {
        this.publicRequest(this.peb_market ? 'pebtrends' : 'trends', { t: Math.random() }, callback, true);
    };

    //
    // Private Functions
    //

    balance(callback) {
        this.privateRequest('balance', {}, callback);
    };

    tradeList(coin, all = 0, since = 0, callback) {
        const type = all ? 'all' : 'open';
        this.privateRequest('trade_list', { coin, type, since }, callback);
    };

    tradeView(coin, id, callback) {
        this.privateRequest('trade_view', { coin, id }, callback);
    };

    tradeCancel(coin, id, callback) {
        this.privateRequest('trade_cancel', { coin, id }, callback);
    };

    tradeAdd(type, coin, price, amount, callback) {
        this.privateRequest('trade_add', { type, coin, price, amount }, callback);
    };

    buy(coin, price, amount, callback) {
        return this.tradeAdd('buy', coin, price, amount, callback);
    };

    sell(coin, price, amount, callback) {
        return this.tradeAdd('sell', coin, price, amount, callback);
    };

    getPoundageDeductedResult(coin, count) {
        // ltc is special in both peb and cny market
        if (coin == 'ltc') {
            return count * 0.998;
        }
        if (!this.peb_market) {
            switch (coin) {
                case 'btc':
                case 'ktc':
                    return count * 0.998;
            }
        }
        return count * 0.999;
    }
}