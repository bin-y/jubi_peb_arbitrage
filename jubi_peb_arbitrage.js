'use strict';

const JUBI = require('./jubiapi.js');
const cp = require('child_process');

const config = {
    max_cny_to_use: 100,
    min_cny_to_use: 10,
    cny_ticker_interval: 0,
    peb_ticker_interval: 200,
    ticker_retry_interval: 100,
    depth_retry_interval: 100,
    deal_retry_interval: 1,
    min_spread_rate: 0.01,
    max_deal_retry: 50,
    max_update_depth_retry: 5,
    coin_trade_cooldown: 3000
};

var options = {
    key: process.argv[2],
    secret: process.argv[3],
    use_https: true,
    keep_alive: true,
    timeout: 1000
};

var jubicny = new JUBI(options);
options.peb_market = true;
var jubipeb = new JUBI(options);

var cny_allticker;
var peb_allticker;
var update_ticker_countdown = 2;
var last_trade_time = {};

function restart() {
    update_ticker_countdown = 2;
    if (config.ticker_interval != 0) {
        setTimeout(update_cny_ticker, config.cny_ticker_interval);
    }
    else {
        update_cny_ticker();
    }
}

function toFixedNoIncrease(x, n) {
    const pow = Math.pow(10, n);
    return Math.floor(x * pow) / pow;
}

function deal(chance) {
    if (chance.use_path1) {
        const buy_coin_price = chance.cny_coin_depth.asks[chance.cny_coin_depth.asks.length - 1][0];
        const sell_coin_price_in_peb = chance.peb_coin_depth.bids[0][0];
        const sell_peb_price = chance.cny_peb_depth.bids[0][0];
        const coin_to_buy = chance.coin_to_buy;
        const coin_to_sell = toFixedNoIncrease(jubicny.getPoundageDeductedResult(chance.coin, coin_to_buy), 4);
        const peb_to_sell = toFixedNoIncrease(jubipeb.getPoundageDeductedResult('peb', coin_to_sell * sell_coin_price_in_peb), 4);

        jubicny.buy(chance.coin, buy_coin_price, coin_to_buy, function (error, data) {
            if (error || data.result != true) {
                console.log(data.code, 'failed to buy', chance.coin, buy_coin_price, coin_to_buy);
                restart();
                return;
            }
            var retry_count = 0;
            jubipeb.sell(chance.coin, sell_coin_price_in_peb, coin_to_sell, function (error, data) {
                if (error || data.result != true) {
                    console.log(data.code, 'retry peb sell', chance.coin, sell_coin_price_in_peb, coin_to_sell);
                    retry_count++;
                    if (retry_count < config.max_deal_retry)
                        return { retry: true };
                    restart();
                    return;
                }
                retry_count = 0;
                jubicny.sell('peb', sell_peb_price, peb_to_sell, function (error, data) {
                    if (error || data.result != true) {
                        console.log(data.code, 'retry sell peb', sell_peb_price, peb_to_sell);
                        retry_count++;
                        if (retry_count < config.max_deal_retry)
                            return { retry_after: 10 };
                        restart();
                        return;
                    }
                    last_trade_time[chance.coin] = Date.now();
                    console.log('dealed!');
                    console.log({ coin_to_buy });
                    console.log({ coin_to_sell });
                    console.log({ peb_to_sell });
                    restart();
                });
            });
        });

    }
    else {
        const buy_peb_price = chance.cny_peb_depth.asks[chance.cny_peb_depth.asks.length - 1];
        const buy_coin_price_in_peb = chance.peb_coin_depth.asks[chance.peb_coin_depth.asks.length - 1];
        const sell_coin_price = chance.cny_coin_depth.bids[0];
        const peb_to_buy = chance.peb_to_buy;
        const peb_to_use = toFixedNoIncrease(jubicny.getPoundageDeductedResult('peb', peb_to_buy), 4);
        const coin_to_buy = toFixedNoIncrease(peb_to_use / buy_coin_price_in_peb, 4);
        const coin_to_sell = toFixedNoIncrease(jubipeb.getPoundageDeductedResult(chance.coin, coin_to_buy), 4);

        jubicny.buy('peb', buy_peb_price, peb_to_buy, function (error, data) {
            if (error || data.result != true) {
                console.log(data.code, 'failed to buy peb', buy_peb_price, peb_to_buy);
                restart();
                return;
            }
            var retry_count = 0;
            jubipeb.buy(chance.coin, buy_coin_price_in_peb, coin_to_buy, function (error, data) {
                if (error || data.result != true) {
                    console.log(data.code, 'retry peb buy', chance.coin, buy_coin_price_in_peb, coin_to_buy);
                    retry_count++;
                    if (retry_count < config.max_deal_retry)
                        return { retry: true };
                    restart();
                    return;
                }
                jubicny.sell(chance.coin, sell_coin_price, coin_to_sell, function (error, data) {
                    if (error || data.result != true) {
                        console.log(data.code, 'retry sell', chance.coin, sell_coin_price, coin_to_sell);
                        retry_count++;
                        if (retry_count < config.max_deal_retry)
                            return { retry_after: 30 };
                        restart();
                        return;
                    }
                    last_trade_time[chance.coin] = Date.now();
                    console.log('dealed!');
                    console.log({ peb_to_buy });
                    console.log({ coin_to_buy });
                    console.log({ coin_to_sell });
                    restart();
                });
            });
        });
    }
}

// cny - coin - peb - cny
function get_spared_rate_on_path1(cny_coin_ask, peb_coin_bid, cny_peb_bid) {
    const cny_price_in_peb_market = peb_coin_bid * cny_peb_bid;

    const spread1 = cny_price_in_peb_market - cny_coin_ask;
    return spread1 / cny_ask;
}

// cny - coin - peb - cny
function get_spared_rate_on_path1(cny_coin_ask, peb_coin_bid, cny_peb_bid) {
    const cny_price_in_peb_market = peb_coin_bid * cny_peb_bid;

    const spread1 = cny_price_in_peb_market - cny_coin_ask;
    return spread1 / cny_ask;
}


function get_spread_rate(cny_coin_ticker, cny_peb_ticker, peb_coin_ticker) {
    const cny_bid = cny_coin_ticker.bid;
    const cny_ask = cny_coin_ticker.ask;

    const cny_price_in_peb_market = peb_coin_ticker.bid * cny_peb_ticker.bid;
    const cny_cost_in_peb_market = peb_coin_ticker.ask * cny_peb_ticker.ask;

    const spread1 = cny_price_in_peb_market - cny_ask; // cny - coin - peb - cny
    const spread2 = cny_bid - cny_cost_in_peb_market; // cny - peb - coin - cny
    const spread_rate1 = spread1 / cny_ask;
    const spread_rate2 = spread2 / cny_cost_in_peb_market;
    return { path1: spread_rate1, path2: spread_rate2 };
}


function recheck_deeper_depth(chance, path, with_depth) {
    // check spread rate again
    var cny_coin_ticker = {
        ask: chance.cny_coin_depth.asks[chance.cny_coin_depth.asks.length - 1][0],
        bid: chance.cny_coin_depth.bids[0][0]
    };
    var cny_peb_ticker = {
        ask: chance.cny_peb_depth.asks[chance.cny_peb_depth.asks.length - 1][0],
        bid: chance.cny_peb_depth.bids[0][0]
    };
    var peb_coin_ticker = {
        ask: chance.peb_coin_depth.asks[chance.peb_coin_depth.asks.length - 1][0],
        bid: chance.peb_coin_depth.bids[0][0]
    };

    const spread_rate = get_spread_rate(cny_coin_ticker, cny_peb_ticker, peb_coin_ticker);

    if (spread_rate.path1 < config.min_spread_rate && spread_rate.path2 < config.min_spread_rate) {
        console.log('chance lost:', chance.name);

        // console.log(cny_allticker[chance.coin], cny_coin_ticker);
        // console.log(cny_allticker['peb'], cny_peb_ticker);
        // console.log(peb_allticker[chance.coin], peb_coin_ticker);
        // console.log({ spread_rate });
        // console.log('');
        restart();
        return;
    }

    if (spread_rate.path1 > spread_rate.path2) {
        chance.use_path1 = true;
        const cny_coin_ask = chance.cny_coin_depth.asks[chance.cny_coin_depth.asks.length - 1];
        const coin_peb_bid = chance.peb_coin_depth.bids[0];
        const peb_cny_bid = chance.cny_peb_depth.bids[0];
        // console.log('cny coin ask:', cny_coin_ask);
        // console.log('coin peb bid:', coin_peb_bid);
        // console.log('peb cny bid:', peb_cny_bid);

        const max_cny_to_use = Math.min(config.max_cny_to_use, cny_coin_ask[0] * cny_coin_ask[1]);
        if (max_cny_to_use < config.min_cny_to_use) {
            console.log('too less money:', chance.name, max_cny_to_use);
            restart();
            return;
        }
        const max_peb_to_sell = peb_cny_bid[0] * peb_cny_bid[1];
        const max_coin_to_sell = Math.min(coin_peb_bid[0] * max_peb_to_sell, coin_peb_bid[1]);

        const coin_to_buy = Math.min(toFixedNoIncrease((max_cny_to_use / cny_coin_ask[0]), 2), max_coin_to_sell);
        const cny_to_use = coin_to_buy * cny_coin_ask[0];

        // console.log('coin to buy:', coin_to_buy);
        // console.log('cny to use:', cny_to_use);

        if (cny_to_use < config.min_cny_to_use) {
            console.log('too less money:', cny_to_use);
            restart();
            return;
        }
        chance.coin_to_buy = coin_to_buy;
        deal(chance);
    }
    else {
        chance.use_path1 = false;
        const cny_peb_ask = chance.cny_peb_depth.asks[chance.cny_peb_depth.asks.length - 1];
        const peb_coin_ask = chance.peb_coin_depth.asks[chance.peb_coin_depth.asks.length - 1];
        const coin_cny_bid = chance.cny_coin_depth.bids[0];
        // console.log('cny coin ask:', cny_peb_ask);
        // console.log('coin peb ask:', peb_coin_ask);
        // console.log('coin cny bid:', coin_cny_bid);

        const max_cny_to_use = Math.min(config.max_cny_to_use, cny_peb_ask[0] * cny_peb_ask[1]);
        if (max_cny_to_use < config.min_cny_to_use) {
            console.log('too less money:', max_cny_to_use);
            restart();
            return;
        }
        const max_coin_to_sell = coin_cny_bid[0] * coin_cny_bid[1];
        const max_peb_to_buy = Math.min(peb_coin_ask[0] * max_coin_to_sell, peb_coin_ask[1]);

        const peb_to_buy = Math.min(toFixedNoIncrease(max_cny_to_use / cny_peb_ask[0], 2), max_peb_to_buy);
        const cny_to_use = peb_to_buy * cny_peb_ask[0];

        // console.log('coin to buy:', peb_to_buy);
        // console.log('cny to use:', cny_to_use);

        if (cny_to_use < config.min_cny_to_use) {
            console.log('too less money:', cny_to_use);
            restart();
            return;
        }
        chance.peb_to_buy = peb_to_buy;
        deal(chance);
    }
}

function check_depth(chances) {
    const chance = chances[chances.current_pos];

    // check spread rate again
    var cny_coin_ticker = {
        ask: chance.cny_coin_depth.asks[chance.cny_coin_depth.asks.length - 1][0],
        bid: chance.cny_coin_depth.bids[0][0]
    };
    var cny_peb_ticker = {
        ask: chance.cny_peb_depth.asks[chance.cny_peb_depth.asks.length - 1][0],
        bid: chance.cny_peb_depth.bids[0][0]
    };
    var peb_coin_ticker = {
        ask: chance.peb_coin_depth.asks[chance.peb_coin_depth.asks.length - 1][0],
        bid: chance.peb_coin_depth.bids[0][0]
    };

    const spread_rate = get_spread_rate(cny_coin_ticker, cny_peb_ticker, peb_coin_ticker);

    if (spread_rate.path1 < config.min_spread_rate && spread_rate.path2 < config.min_spread_rate) {
        console.log('chance lost:', chance.name, spread_rate);
        if (peb_allticker[chance.coin].buy != peb_coin_ticker.bid
            || peb_allticker[chance.coin].sell != peb_coin_ticker.ask) {
            console.log('different between peb-coin ticker and depth:', peb_allticker[chance.coin], peb_coin_ticker);
        }
        if (cny_allticker[chance.coin].buy != cny_coin_ticker.bid
            || cny_allticker[chance.coin].sell != cny_coin_ticker.ask) {
            console.log('different between cny-coin ticker and depth:', cny_allticker[chance.coin], cny_coin_ticker);
        }
        if (cny_allticker['peb'].buy != cny_peb_ticker.bid
            || cny_allticker['peb'].sell != cny_peb_ticker.ask) {
            console.log('different between cny-peb ticker and depth:', cny_allticker['peb'], cny_peb_ticker);
        }
        // console.log(cny_allticker[chance.coin], cny_coin_ticker);
        // console.log(cny_allticker['peb'], cny_peb_ticker);
        // console.log(peb_allticker[chance.coin], peb_coin_ticker);
        // console.log({ spread_rate });
        // console.log('');
        update_depth(chances);
        return;
    }

    if (spread_rate.path1 > spread_rate.path2) {
        chance.use_path1 = true;
        const cny_coin_ask = chance.cny_coin_depth.asks[chance.cny_coin_depth.asks.length - 1];
        const coin_peb_bid = chance.peb_coin_depth.bids[0];
        const peb_cny_bid = chance.cny_peb_depth.bids[0];
        // console.log('cny coin ask:', cny_coin_ask);
        // console.log('coin peb bid:', coin_peb_bid);
        // console.log('peb cny bid:', peb_cny_bid);

        const max_cny_to_use = Math.min(config.max_cny_to_use, cny_coin_ask[0] * cny_coin_ask[1]);
        if (max_cny_to_use < config.min_cny_to_use) {
            console.log('too less money:', chance.name, max_cny_to_use);
            update_depth(chances);
            return;
        }
        const max_peb_to_sell = peb_cny_bid[0] * peb_cny_bid[1];
        const max_coin_to_sell = Math.min(coin_peb_bid[0] * max_peb_to_sell, coin_peb_bid[1]);

        const coin_to_buy = Math.min(toFixedNoIncrease((max_cny_to_use / cny_coin_ask[0]), 2), max_coin_to_sell);
        const cny_to_use = coin_to_buy * cny_coin_ask[0];

        // console.log('coin to buy:', coin_to_buy);
        // console.log('cny to use:', cny_to_use);

        if (cny_to_use < config.min_cny_to_use) {
            console.log('too less money:', cny_to_use);
            update_depth(chances);
            return;
        }
        chance.coin_to_buy = coin_to_buy;
        deal(chance);
    }
    else {
        chance.use_path1 = false;
        const cny_peb_ask = chance.cny_peb_depth.asks[chance.cny_peb_depth.asks.length - 1];
        const peb_coin_ask = chance.peb_coin_depth.asks[chance.peb_coin_depth.asks.length - 1];
        const coin_cny_bid = chance.cny_coin_depth.bids[0];
        // console.log('cny coin ask:', cny_peb_ask);
        // console.log('coin peb ask:', peb_coin_ask);
        // console.log('coin cny bid:', coin_cny_bid);

        const max_cny_to_use = Math.min(config.max_cny_to_use, cny_peb_ask[0] * cny_peb_ask[1]);
        if (max_cny_to_use < config.min_cny_to_use) {
            console.log('too less money:', max_cny_to_use);
            update_depth(chances);
            return;
        }
        const max_coin_to_sell = coin_cny_bid[0] * coin_cny_bid[1];
        const max_peb_to_buy = Math.min(peb_coin_ask[0] * max_coin_to_sell, peb_coin_ask[1]);

        const peb_to_buy = Math.min(toFixedNoIncrease(max_cny_to_use / cny_peb_ask[0], 2), max_peb_to_buy);
        const cny_to_use = peb_to_buy * cny_peb_ask[0];

        // console.log('coin to buy:', peb_to_buy);
        // console.log('cny to use:', cny_to_use);

        if (cny_to_use < config.min_cny_to_use) {
            console.log('too less money:', cny_to_use);
            update_depth(chances);
            return;
        }
        chance.peb_to_buy = peb_to_buy;
        deal(chance);
    }
}

function update_depth(chances) {
    if (chances.current_pos == undefined)
        chances.current_pos = 0;
    else chances.current_pos++;

    if (chances.current_pos >= chances.length) {
        setTimeout(restart, 1000);
        return;
    }
    var chance = chances[chances.current_pos];


    var depth_request_array = [
        {
            api: jubicny,
            coin: chance.coin,
            callback: function (data) { chance.cny_coin_depth = data; }
        },
        {
            api: jubicny,
            coin: 'peb',
            callback: function (data) { chance.cny_peb_depth = data; }
        },
        {
            api: jubipeb,
            coin: chance.coin,
            callback: function (data) {
                chance.peb_coin_depth = data;
                // check_depth(chance);
            }
        }
    ];
    var update_depth_countdown = 3;
    var retry_count = 0;
    var stop = false;
    function callback(error, data) {
        if (stop) {
            return;
        }
        if (error || data.length == 0) {
            // if (error) {
            //     console.log(error);
            // }
            console.log('retry update depth', this.coin, retry_count);
            retry_count++;
            if (retry_count < config.max_update_depth_retry)
                return { retry_after: config.depth_retry_interval };
            stop = true;
            console.log('max retry count reached, go for next chance', chances.current_pos);
            setTimeout(function () { update_depth(chances); }, config.depth_retry_interval);
            return;
        }
        this.callback(data);
        update_depth_countdown--;
        if (update_depth_countdown == 0)
            check_depth(chances);
    };

    depth_request_array.forEach(function (element) {
        element.api.depth(element.coin, callback.bind(element));
    }, this);
}

var ticker_dps = 0;
function dps_printer() {
    process.title = 'ticker dps:' + ticker_dps;
    ticker_dps = 0;
    setTimeout(dps_printer, 1000);
}
setTimeout(dps_printer, 1000);

function cny_ticker_done() {
    ticker_dps++;
    var cny_peb_ticker = { ask: cny_allticker['peb'].sell, bid: cny_allticker['peb'].buy };

    var chances = [];
    for (var coin in peb_allticker) {
        var info = cny_allticker[coin];
        if (!info) {
            continue;
        }

        const name = jubicny.coin_name[coin];
        const cny_coin_ticker = { ask: info.sell, bid: info.buy };
        info = peb_allticker[coin];
        const peb_coin_ticker = { ask: info.sell, bid: info.buy };

        const spread_rate = get_spread_rate(cny_coin_ticker, cny_peb_ticker, peb_coin_ticker);

        if (spread_rate.path1 < config.min_spread_rate && spread_rate.path2 < config.min_spread_rate) {
            continue;
        }

        chances.push({
            name: name,
            coin: coin,
            // cny_info: cny_info,
            // peb_info: peb_info,
            spread_rate: Math.max(spread_rate.path1, spread_rate.path2)
        })
    }

    chances.sort(function (a, b) {
        return b.spread_rate - a.spread_rate;
    });
    // chances.forEach(function (coin) {
    //     console.log(coin.coin);
    //     console.log('cny ' + coin.cny_info);
    //     console.log('p-c ' + coin.peb_info);
    //     console.log('spread [' + (use_path1 ? '1' : '2') + ']:' + toFixedNoIncrease(coin.spread_rate * 100, 2) + '%(' + toFixedNoIncrease(coin.spread, 2) + ')')
    //     console.log('');
    // });
    if (chances.length) {
        update_depth(chances);
        // console.log('peb: \tbid:' + peb_bid_price + '\task:' + peb_ask_price);

        if (last_trade_time[chances[0].coin]
            && (Date.now() - last_trade_time[chances[0].coin]) < config.coin_trade_cooldown) {
            console.log(chances[0].coin, 'is on trade cooldown');
            restart();
        }
        return;
    }
    restart();
}

function update_cny_ticker() {
    jubicny.allTickers(function (error, data) {
        if (!data || data.length == 0) {
            setTimeout(restart, config.ticker_retry_interval);
            return;
        }

        cny_allticker = data;
        if (peb_allticker) {
            cny_ticker_done();
        }
        else {
            restart();
        }
    });

}

function update_peb_ticker() {
    jubipeb.allTickers(function (error, data) {
        if (!data || data.length == 0) {
            setTimeout(restart, config.ticker_retry_interval);
            return;
        }

        peb_allticker = data;
        setTimeout(update_peb_ticker, config.peb_ticker_interval);
    });
}

update_cny_ticker();
update_peb_ticker();