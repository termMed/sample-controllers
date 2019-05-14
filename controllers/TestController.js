'use strict';

var utils = require('../utils/writer.js');
var TestController = require('../service/TestControllerService');

module.exports.usersUsersGET = function usersUsersGET (req, res, next) {
  TestController.usersUsersGET()
    .then(function (response) {
      // utils.writeJson(res, response);
      console.log('Then ' + res + response);
      res.end();
    })
    .catch(function (response) {
      // utils.writeJson(res, response);
      console.log('Catch '+ res + response);
    });
};
