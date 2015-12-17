'use strict';


var sUtil = require('../lib/util');
var texvcInfo = require('texvcinfo');
var HTTPError = sUtil.HTTPError;


/**
 * The main router object
 */
var router = sUtil.router();

/**
 * The main application object reported when this module is require()d
 */
var app;


/* The response headers for different render types */
var outHeaders = {
    svg: {
        'content-type': 'image/svg+xml'
    },
    png: {
        'content-type': 'image/png'
    },
    mml: {
        'content-type': 'application/mathml+xml'
    }
};


function emitError(txt,detail) {
    if (detail === undefined) {
        detail = txt;
    }
    throw new HTTPError({
        status: 400,
        success: false,
        title: 'Bad Request',
        type: 'bad_request',
        detail: detail,
        error: txt
    });
}

function emitFormatError(format) {
    emitError("Output format " + format + " is disabled via config, try setting \"" +
        format + ": true\" to enable " + format + "rendering.");
}

function handleRequest(res, q, type, outFormat, features) {
    var sanitizedTex;
    var svg = app.conf.svg && /^svg|json|complete$/.test(outFormat);
    var mml = (type !== "MathML") && /^mml|json|complete$/.test(outFormat);
    var png = app.conf.png && /^png|json|complete$/.test(outFormat);
    var img = app.conf.img && /^json|complete$/.test(outFormat);
    var speakText = (outFormat !== "png") && features.speakText;

    if (type === "TeX" || type === "inline-TeX") {
        /* TODO: TEMP TEMP TEMP
         * This is a nasty hack to prevent Mathoid from entering a
         * recursive loop, cf. https://phabricator.wikimedia.org/T121762
         */
        if (/\\limits_\{\s*\\binom\{/.test(q)) {
            throw new HTTPError({
                status: 500,
                success: false,
                title: 'Internal server error',
                type: 'internal_error',
                detail: {
                    "success": false,
                    "error": {
                        "message": "\\limits_{\\binom is currently not supported by Mathoid",
                        "expected": [],
                        "found": "\\biom",
                        "location": {
                            "start": {
                                "offset": 0,
                                "line": 1,
                                "column": 0
                            },
                            "end": {
                                "offset": 0,
                                "line": 1,
                                "column": 0
                            }
                        },
                    }
                },
                error: "\\limits_{\\binom is currently not supported by Mathoid"
            });
        }
        /* TODO: END TEMP */
        var feedback = texvcInfo.feedback(q);
        // XXX properly handle errors here!
        if (feedback.success) {
            sanitizedTex = feedback.checked || '';
            q = sanitizedTex;
        } else {
            emitError(feedback.error.name + ': ' + feedback.error.message, feedback);
        }
        if (app.conf.texvcinfo && outFormat === "texvcinfo") {
            res.json(feedback).end();
            return;
        }
    }

    app.mjAPI.typeset({
        math: q,
        format: type,
        svg: svg,
        img: img,
        mml: mml,
        speakText: speakText,
        png: png
    }, function (data) {
        if (data.errors) {
            data.success = false;
            // @deprecated replace with emitError
            data.log = "Error:" + JSON.stringify(data.errors);
        } else {
            data.success = true;
            // @deprecated
            data.log = "success";
        }

        // Strip some styling returned by MathJax
        if (data.svg) {
            data.svg = data.svg.replace(/style="([^"]+)"/, function (match, style) {
                return 'style="'
                    + style.replace(/(?:margin(?:-[a-z]+)?|position):[^;]+; */g, '')
                    + '"';
            });
        }

        // Return the sanitized TeX to the client
        if (sanitizedTex !== undefined) {
            data.sanetex = sanitizedTex;
        }
        switch (outFormat) {
            case 'json':
                res.json(data).end();
                break;
            case 'complete':
                Object.keys(outHeaders).forEach(function (outType) {
                    if (data[outType]) {
                        data[outType] = {
                            headers: outHeaders[outType],
                            body: data[outType]
                        };
                    }
                });
                res.json(data).end();
                break;
            default:
                res.set(outHeaders[outFormat]);
                res.send(data[outFormat]).end();
        }
    });
}


/**
 * POST /
 * Performs the rendering request
 */
router.post('/:outformat?/', function (req, res) {
    var outFormat;
    var speakText = app.conf.speakText;
    // First some rudimentary input validation
    if (!(req.body.q)) {
        emitError("q (query) post parameter is missing!");
    }
    var q = req.body.q;
    var type = (req.body.type || 'tex').toLowerCase();
    switch (type) {
        case "tex":
            type = "TeX";
            break;
        case "inline-tex":
            type = "inline-TeX";
            break;
        case "mml":
        case "mathml":
            type = "MathML";
            break;
        case "ascii":
        case "asciimathml":
        case "asciimath":
            type = "AsciiMath";
            break;
        default :
            emitError("Input format \"" + type + "\" is not recognized!");
    }
    if (req.body.noSpeak) {
        speakText = false;
    }
    function setOutFormat(fmt) {
        if (app.conf[fmt]) {
            outFormat = fmt;
        } else {
            emitFormatError(fmt);
        }
    }

    if (req.params.outformat) {
        switch (req.params.outformat.toLowerCase()) {
            case "svg":
                setOutFormat('svg');
                break;
            case "png":
                setOutFormat('png');
                break;
            case "texvcinfo":
                setOutFormat('texvcinfo');
                if (!/tex$/i.test(type)) {
                    emitError('texvcinfo accepts only tex or inline-tex as the input type, "' + type + '" given!');
                }
                break;
            case "json":
                outFormat = "json";
                break;
            case 'complete':
                outFormat = 'complete';
                break;
            case "mml":
            case "mathml":
                outFormat = "mml";
                break;
            default:
                emitError("Output format \"" + req.params.outformat + "\" is not recognized!");
        }
    } else {
        outFormat = "json";
    }
    handleRequest(res, q, type, outFormat, {speakText:speakText});

});


module.exports = function (appObj) {

    app = appObj;

    return {
        path: '/',
        skip_domain: true,
        router: router
    };

};

