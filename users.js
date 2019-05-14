var express = require('express');
var router = express.Router();
var passport = require('passport');
var BearerStrategy = require('passport-http-bearer').Strategy;
var LocalStrategy = require('passport-local').Strategy;
var secret = 'snomedctlogin';
var mongoose = require('mongoose');
var User = mongoose.model('User');
var BSON = require('mongodb').BSONPure;
var eventLogger = require('../lib/eventsLog');
var path = require('path');
var http = require('https');
var fs = require('fs');
var projectRoutes = require('../lib/projects');
var conceptHelper = require('./conceptHelper');
var CronJob = require('cron').CronJob;

var topModule = module;
while(topModule.parent)
    topModule = topModule.parent;
var appDir = path.dirname(topModule.filename);
var dbs = require('./../util/databases');
// TEST: curl -v -d "username=bob&password=secret" http://127.0.0.1:3001/users/login
// curl http://127.0.0.1:3001/users/authenticate?access_token=123456789
var servers = {};

var getMailOfPreferences = function(username, callback){
    dbs.getDb("server", function (err, db) {
        if (err){
            callback("");
        }else{
            var collection = db.collection("preferences");
            collection.find({"id": username}, function(err, cursor){
                if (err){
                    eventLogger.log("error", err.message);
                    // console.log('Database error:' + err.toString());
                    callback("");
                }else {
                    cursor.toArray(function (err, preferences) {
                        if (err){
                            eventLogger.log("error", err.message);
                            // console.log(err);
                            callback("");
                        }else{
                            if (preferences && preferences[0] && preferences[0].email && preferences[0].email.email)
                                callback(preferences[0].email.email);
                            else
                                callback("");
                        }
                    });
                }
            });
        }
    });
};

var usersTokens = [
    { id: 1, username: 'bob', token: '123456789', email: 'bob@example.com' }
    , { id: 2, username: 'joe', token: 'abcdefghi', email: 'joe@example.com' }
];

function findByToken(token, fn) {
    for (var i = 0, len = usersTokens.length; i < len; i++) {
        var user = usersTokens[i];
        if (user.token === token) {
            return fn(null, user);
        }
    }
    return fn(null, null);
}

passport.use(new BearerStrategy({
    },
    function(token, done) {
        process.nextTick(function () {
            User.findOne({ token: token }, function(err, user) {
                if (err) { return done(err); }
                if (!user) { return done(null, false); }
                return done(null, user);
            });
        });
    }
));

passport.use(new LocalStrategy(function(username, password, done) {
//    console.log("Entrando a local");
    User.findOne({ username: username }, function(err, user) {
        if (err) { return done(err); }
        if (!user) { return done(null, false, { message: 'Unknown user ' + username }); }
        user.comparePassword(password, function(err, isMatch) {
            if (err) return done(err);
            if(isMatch) {
                return done(null, user);
            } else {
                return done(null, false, { message: 'Invalid password' });
            }
        });
    });
}));

//Passport example ****************
//var User = mongoose.model('User');
//var user = new User({ username: 'bob', email: 'bob@example.com', password: 'secret' });
//user.save(function(err) {
//    if(err) {
//        console.log(err);
//    } else {
//        console.log('user: ' + user.username + " saved.");
//    }
//});

passport.serializeUser(function(user, done) {
    done(null, user.id);
});

passport.deserializeUser(function(id, done) {
    User.findById(id, function (err, user) {
        done(err, user);
    });
});

var rand = function() {
    return Math.random().toString(36).substr(2); // remove `0.`
};

var token = function() {
    return rand() + rand(); // to make it longer
};

router.post('/sync', function(req, res, next){
    if (typeof req.body.secondaryUrl != 'undefined'){
        User.find({}, function (err, users) {
            if (err){
                res.status(500);
                res.send(err);
            }else{
//                res.send(users);
                var usersArray = [], usersToInsert = [];
                users.forEach(function(user){
                    usersToInsert.push({
                        username: user.username,
                        admin: user.admin,
                        password: user.password,
                        email: user.email,
                        token: user.token
                    });
                    usersArray.push(user.username);
                });
                dbs.getDb("server", function(err, db){
                    if (err){
                        res.send(err, 500);
                    }else{
                        var collection = db.collection("users");
                        collection.remove({username:{$in: usersArray}}, function(err) {
                            if (err) {
                                // console.log(err.message);
                                eventLogger.log("error", err.message);
                                res.status(500);
                                res.send("Error!");
                            }else{
                                collection.insert(usersToInsert, function(err, obj){
                                    if(err){
                                        // console.log(err.message);
                                        eventLogger.log("error", err.message);
                                        res.status(500);
                                        res.send(users);
//                                    res.send("Error!");
                                    }else{
                                        res.status(200);
                                        res.send("Synced!");
                                    }
                                });
                            }
                        });
                    }
                }, req.body.secondaryUrl);
            }
        })
    }else{
        res.status(400);
        res.send("Please send url!");
    }
});

router.get('/users/', function(req, res, next){
    var query = {};
    if (req.query["username"])
        query["username"] = req.query["username"];
    if (req.query["token"])
        query["token"] = req.query["token"];
    User.find(query, function (err, users) {
        if (err){
            res.send(err);
        }else{
            var index = 0;
            var avatarCreated = false;
            var createAvatarLoop = function(callback){
                if (index == users.length) callback();
                else{
                    var userLoop = users[index];
                    if (typeof userLoop == "string") userLoop = {username: userLoop};
                    // console.log("user", userLoop.username);
                    fs.exists(appDir + "/public/avatar/" + userLoop.username + ".png", function(exists) {
                        // console.log("exists:", exists);
                        var createFile = function(){
                            var file = fs.createWriteStream(appDir + "/public/avatar/" + userLoop.username + ".png");
                            var request = http.get("https://robohash.org/" + userLoop.username + "?size=344x344&bgset=bg1", function(response) {
                                // console.log("get... done");
                                response.pipe(file);
                                index++;
                                createAvatarLoop(callback);
                            });
                        };
                        if (!exists) {
                            // console.log("creating file");
                            avatarCreated = true;
                            createFile();
                        }else{
                            fs.readFile(appDir + "/public/avatar/" + userLoop.username + ".png", function(err, data) {
                                if (err){
                                    eventLogger.log("error", "Error creating avatar", {err: err});
                                    index++;
                                    createAvatarLoop(callback);
                                }else {
                                    var dataStr = data.toString();
                                    if (dataStr){
                                        index++;
                                        createAvatarLoop(callback);
                                    }else{
                                        createFile();
                                    }
                                }
                            });
                        }
                    });
                }
            };
            if (!users || !users.length) users = [];
            res.send(users);
            users.push("maintenance");
            users.push("promoted in batch");
            users.push("import");
            users.push("batch process");
            createAvatarLoop(function(){
                if (avatarCreated)
                    eventLogger.log("info", "user avatars created");
                // console.log("user avatars created");
            });
        }
    })
});

var nodemailer = require('nodemailer');
// create reusable transporter object using SMTP transport
var transporter = nodemailer.createTransport('smtps://support%40termmed.com:snomed11@smtp.gmail.com');

router.get('/authenticate',
    // Authenticate using HTTP Bearer credentials, with session support disabled.
    passport.authenticate('bearer', { session: false }),
    function(req, res){
        res.json({ username: req.user.username, email: req.user.email, admin: req.user.admin}, 200);
    });

var guid = (function() {
    function s4() {
        return Math.floor((1 + Math.random()) * 0x10000)
            .toString(16)
            .substring(1);
    }
    return function() {
        return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
            s4() + '-' + s4() + s4() + s4();
    };
})();

router.post('/forgotPassword', function(req, res, next) {
    var username = false;
    if (req.query["username"])
        username = req.query["username"];
    if (username){
        User.findOne({username: username}, function(err, obj){
            if(err)
                res.end('Invalid username!', 500);
            if (obj == null){
                res.end('Invalid username!', 500);
            }else{
// setup e-mail data with unicode symbols
                var newPassword = guid();
                var mailOptions = {
                    from: 'Termmed Service ✔ <support@termmed.com>', // sender address
                    to: obj.email, // list of receivers
                    subject: 'Password of termspace', // Subject line
                    text: 'Hello ' + obj.username + ", your new password is: " + newPassword, // plaintext body
                    html: 'Hello ' + obj.username + ", your new password is: " + '<b>' + newPassword + '</b><br>Tip: You can change your password in User Profile' // html body
                };

                getMailOfPreferences(obj.username, function(newMail){
                    if (newMail)
                        mailOptions.to = newMail;
                    obj.password = newPassword;
                    obj.save(function(err){
                        if (err){
                            res.end('Database error saving', 500);
                        }else{
                            // send mail with defined transport object
                            transporter.sendMail(mailOptions, function(error, info){
                                if(error){
                                    // console.log(error);
                                    eventLogger.log("error", "Error sending mail", {error: error});
                                    res.end('Error sending mail!', 500);
                                }else{
                                    res.send('New password sent to your email!', 200);
                                }
                            });
                            eventLogger.log("info", 'Forgot password', { username: obj.username});
                        }
                    });
                });
            }
        });
    }else{
        res.end('Invalid username!', 500);
    }
});

router.post('/login', function(req, res, next) {
//    console.log("Pre local");
    passport.authenticate('local', function(err, user, info) {
        if (err) { return next(err) }
        if (!user) {
            return res.send({"msg":"Unauthorized"}, 401);
        }
        req.logIn(user, function(err) {
            if (err) { return next(err); }
            var newToken = token();
            if (typeof req.body.tokenGenerated != "undefined")
                newToken = req.body.tokenGenerated;
            eventLogger.log("info", 'Log in ' + user.username, { username: user.username});
            User.findByIdAndUpdate({_id: user._id}, {$set: {token: newToken}},{safe: true, upsert: false}, function(err, obj){
                if(err){
                    // console.log(err.message);
                    eventLogger.log("error", "Error updating token", {error: err});
                    res.send('Update token error ', 500);
                }else if (typeof obj == "undefined")
                    res.send('User not found ', 500);
                else
                    res.send({token: newToken, email: obj.email, admin: obj.admin, jira: obj.jira, crs: obj.crs}, 200);
            });
        });
    })(req, res, next);
});

router.get('/logout', function(req, res){
    req.logout();
    res.send("logged out", 200);
});

router.post('/register', function(req, res) {
    var user = new User(req.body);
    user.save(function(err) {
        if(err) {
            // console.log(err.message);
            eventLogger.log("error", "Error creating new user", {error: err});
            res.status(500);
            res.end(err.message);
        } else {
            eventLogger.log("info", 'New user', { username: user.username});
            res.end('User created', 200);
        }
    });
});

router.put('/:id', function(req, res) {
    var user = new User(req.body);
    var obj_id = BSON.ObjectID.createFromHexString(req.params.id);
    var password = user.password;
    if (user._id != req.params.id) {
        res.end('Ids do not match!', 400);
    } else {
        User.findOne({_id: obj_id}, function(err, obj){
            if(err){
                res.end('Database error', 500);
            }
//            user = new User(obj);
            obj.password = password;
            obj.save(function(err){
                if (err){
                    res.end('Database error saving', 500);
                }else{
                    res.end('Update complete', 200);
                }
            });
        });
    }
});

router.put('/email/:id', function(req, res) {
    var user = req.body;
    var obj_id = BSON.ObjectID.createFromHexString(req.params.id);
    var email = user.email;
    if (user._id != req.params.id) {
        res.end('Ids do not match!', 400);
    } else {
        User.findOne({_id: obj_id}, function(err, obj){
            if(err){
                res.end('Database error', 500);
            }
            obj.email = email;
            obj.save(function(err){
                if (err){
                    res.end('Database error saving', 500);
                }else{
                    res.end('Update complete', 200);
                }
            });
        });
    }
});

router.delete('/:id', function(req, res) {
    var obj_id = BSON.ObjectID.createFromHexString(req.params.id);
    User.remove({_id: obj_id}, function(err){
        if(err){
            res.end('Database error', 500);
        }else{
            res.end('Delete complete', 200);
        }
    });
});

router.put('/jira/:id', function(req, res) {
    var user = new User(req.body);
    var jira = user.jira;
    var obj_id = BSON.ObjectID.createFromHexString(req.params.id);
    if (user._id != req.params.id) {
        res.end('Ids do not match!', 400);
    } else {
        User.findOne({_id: obj_id}, function(err, obj){
            if(err){
                res.end('Database error', 500);
            }
            obj.jira = jira;
            obj.save(function(err){
                if (err){
                    res.end('Database error saving', 500);
                }else{
                    res.end('Update complete', 200);
                }
            });
        });
    }
});

router.put('/crs/:id', function(req, res) {
    var user = new User(req.body);
    var crs = user.crs;
    var obj_id = BSON.ObjectID.createFromHexString(req.params.id);
    if (user._id != req.params.id) {
        res.end('Ids do not match!', 400);
    } else {
        User.findOne({_id: obj_id}, function(err, obj){
            if(err){
                res.end('Database error', 500);
            }
            obj.crs = crs;
            obj.save(function(err){
                if (err){
                    res.end('Database error saving', 500);
                }else{
                    res.end('Update complete', 200);
                }
            });
        });
    }
});

var runWeeklyReport = function(callback){
    var workflowDefinitions = {};
    projectRoutes.getAllProjects(function(err, projects){
        if (err){
            callback(err);
        }else{
            User.find({}, function (err, users) {
                if (err){
                    callback(err);
                }else{
                    var errors = [];
                    var sendMailLoop = function(index){
                        if (index == users.length){
                            if (errors.length)
                                callback(errors);
                            else
                                callback("Success");

                        }else{
                            var projectsUser = [];
                            projects.forEach(function(projectLoop){
                                if (projectLoop.users && projectLoop.users.length){
                                    projectLoop.users.forEach(function(userLoop){
                                        if (userLoop == users[index].username || (userLoop && userLoop.name == users[index].username))
                                            projectsUser.push(projectLoop);
                                    });
                                }
                            });

                            var sendMailProjectLoop = function(indexP){
                                if (indexP == projectsUser.length){
                                    sendMailLoop(index + 1);
                                }else{
                                    var getWorkflowDefinition = function(callback){
                                        if (workflowDefinitions[projectsUser[indexP].workflowDefinition]){
                                            callback(workflowDefinitions[projectsUser[indexP].workflowDefinition]);
                                        }else{
                                            conceptHelper.getWorkflowDefinition(projectsUser[indexP].baseEdition, projectsUser[indexP].workflowDefinition, projectsUser[indexP].devPath.path, function(err, workflowDef){
                                                if (err){
                                                    // console.log(err);
                                                    eventLogger.log("error", err.message);
                                                }else{
                                                    workflowDefinitions[projectsUser[indexP].workflowDefinition] = workflowDef;
                                                    callback(workflowDefinitions[projectsUser[indexP].workflowDefinition]);
                                                }
                                            });
                                        }
                                    };
                                    getWorkflowDefinition(function(workflowDefinition){
                                        var openStates = [];
                                        if (workflowDefinition && workflowDefinition.openStates && workflowDefinition.openStates.length)
                                            openStates = workflowDefinition.openStates;
                                        dbs.getDb("server", function(err, db) {
                                            if (err){

                                            }else{
                                                var collection = db.collection("workflowInstances");
                                                var query = {
                                                    workflowState: { $in: openStates},
                                                    assignee: users[index].username,
                                                    projectId: projectsUser[indexP]._id
                                                };
                                                collection.find(query, function (err, cursor) {
                                                    cursor.toArray(function(err, docs) {
                                                        if (err) {
                                                            console.log(err);
                                                        } else {

                                                        }
                                                    });
                                                });
                                            }
                                        }, projectsUser[indexP].baseEdition);
                                    });

                                    var mailOptions = {
                                        from: 'Termmed Service ✔ <support@termmed.com>', // sender address
                                        to: users[index].email, // list of receivers
                                        subject: 'Password of termspace', // Subject line
                                        text: 'Hello ' + obj.username + ", your new password is: " + newPassword, // plaintext body
                                        html: 'Hello ' + obj.username + ", your new password is: " + '<b>' + newPassword + '</b><br>Tip: You can change your password in User Profile' // html body
                                    };
                                    transporter.sendMail(mailOptions, function(error, info){
                                        if(error){
                                            errors.push(error);
                                        }
                                        sendMailProjectLoop(indexP + 1);
                                    });
                                }
                            };

                            if (projectsUser.length){
                                getMailOfPreferences(users[index].username, function(newMail){
                                    if (newMail)
                                        users[index].email = newMail;
                                    sendMailProjectLoop(0);
                                });
                            }else
                                sendMailLoop(index + 1);
                        }
                    };
                    sendMailLoop(0);
                }
            });
        }
    });
};

var job = new CronJob('00 00 00 * * 5', function() {
    var count = 0;
    var runWeeklyReportTillDone = function(){
        count++;
        if (count == 1000){
            // console.warn("1000 tries to run weekly reports without success!");
            eventLogger.log("error", "1000 tries to run weekly reports without success!");
        }else{
            runWeeklyReport(function(result){
                if (result != 'Weekly Reports scheduled'){
                    setTimeout(function(){
                        runWeeklyReportTillDone();
                    }, 5000);
                }
            });
        }
    };
    //runWeeklyReportTillDone();
}, function () {
    /* This function is executed when the job stops */
},true, "America/Argentina/San_Juan"); /* Start the job right now *///timeZone /* Time zone of this job. */);

module.exports = router;