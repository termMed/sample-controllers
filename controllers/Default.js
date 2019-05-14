'use strict';

var utils = require('../utils/writer.js');
var Default = require('../service/DefaultService');

module.exports.usersAuthenticateGET = function usersAuthenticateGET (req, res, next) {
  Default.usersAuthenticateGET()
    .then(function (response) {
      utils.writeJson(res, response);
    })
    .catch(function (response) {
      utils.writeJson(res, response);
    });
};

module.exports.usersLoginPOST = function usersLoginPOST (req, res, next) {
  Default.usersLoginPOST()
    .then(function (response) {
      utils.writeJson(res, response);
    })
    .catch(function (response) {
      utils.writeJson(res, response);
    });
};

module.exports.usersLogoutGET = function usersLogoutGET (req, res, next) {
  Default.usersLogoutGET()
    .then(function (response) {
      utils.writeJson(res, response);
    })
    .catch(function (response) {
      utils.writeJson(res, response);
    });
};
