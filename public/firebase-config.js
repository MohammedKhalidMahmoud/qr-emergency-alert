(function (global) {
  global.FIREBASE_CONFIG = {
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: ''
  };

  global.FIREBASE_VAPID_KEY = '';

  global.APP_CONFIG = {
    apiBaseUrl: ''
  };
})(typeof self !== 'undefined' ? self : window);
