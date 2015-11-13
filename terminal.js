var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var path = require('path');
var walk = require('walk');
var Twit = require('twit');
var fs = require('fs');

var GpioHelper = require("./gpiohelper.js");
var FfmpegHelper = require("./ffmpeghelper.js");

var credentials = require('./twitter_credentials.json');


// twitter credentials
var T = new Twit({
  consumer_key: credentials.twitter_consumer_key,
  consumer_secret: credentials.twitter_consumer_secret,
  access_token: credentials.twitter_access_token_key,
  access_token_secret: credentials.twitter_access_token_secret
});

var giffiles   = [];
var captureIsBusy = false;
var gifpath = "";



// #######################
// GPIO Helper and Events
// #######################
var gpio_helper = new GpioHelper();
gpio_helper.on("button-released", function (resultobject) {
  //console.log("button-released");
});
gpio_helper.on("button-down", function (resultobject) {
  //console.log("button-down");
  if (captureIsBusy) {
    console.log("capture process running! try again later...");
  }else{

    captureIsBusy = true;
    gpio_helper.doCountdownAnimation();


    setTimeout(function(){
      gpio_helper.stopGreen();
      gpio_helper.startBlinkingRed();
      gpio_helper.startBlinkingYellow();

      ffmpeg_helper.captureVideo();
    }, 1600);

  }
});

// #######################
// FFMPEG Helper
// #######################
var ffmpeg_helper = new FfmpegHelper();
ffmpeg_helper.on("video-created", function (resultobject) {
  //console.log("video-created");
  gpio_helper.stopBlinkingYellow();
  // create gif
  //ffmpeg_helper.createGIF();
  ffmpeg_helper.createWatermark();
});

ffmpeg_helper.on("watermark-created", function (resultobject) {
  //console.log("watermark-created");
  //gpio_helper.stopBlinkingYellow();
  // create gif
  ffmpeg_helper.createGIF();
});

ffmpeg_helper.on("gif-created", function (tmpgifsrc) {
  //console.log("gif-created :: " + tmpgifsrc);

  // storing the filename in a local var
  gifpath = tmpgifsrc;

  // emit the event with the filename for frontend
  io.emit('gif created', tmpgifsrc);
});

ffmpeg_helper.on("palette-created", function (tmpgifsrc) {
  //console.log("palette-created :: " + tmpgifsrc);

  // event just for showing a status in the frontend loader
  io.emit('palette created');
});

ffmpeg_helper.on("qr-created", function (resultobject) {

  //console.log("qr-created");

  // reset the status var
  captureIsBusy = false;

  gpio_helper.stopBlinkingRed();
  gpio_helper.startGreen();

  io.emit('qr created');
});

ffmpeg_helper.on("stillimage-created", function () {
  io.emit('image created');
});

ffmpeg_helper.on("video-created", function () {
  io.emit('video created');
});


// ###########################
// Express config and routing
// ###########################

// express.js PUBLIC STATIC FILES
app.use(express.static('public'));

// express.js ROUTING -> root
app.get('/', function(req, res, next){
  //console.log("root page");
  next();
}, function (req, res) {
  res.sendFile(path.join(__dirname, './public', 'scroll.html'));
});

// express.js ROUTING -> serving gifs page
// fetch of gifs is triggered via socket.io
app.get('/gifs', function(req, res, next){
  console.log("gifs page");
  next();
}, function (req, res) {
  res.sendFile(path.join(__dirname, './public', 'gifs.html'));
});

// listen on port
http.listen(3000, function(){
  console.log('listening on *:3000');
  gpio_helper.doStartAnimation();
});

// ###########################
// socket.io
// ###########################
io.on('connection', function(socket){
  //console.log('a user connected');
  // disconnect
  socket.on('disconnect', function(){
    //console.log('user disconnected');
  });
  // fetch GIFs if browser loads the page and emits msg
  socket.on('fetch gifs', fetchGIFs);

  socket.on('update image', ffmpeg_helper.captureStillImage);
  // generate and update the video
  socket.on('create video', captureVideo);
  // generate GIF from video
  socket.on('create gif', ffmpeg_helper.createGIF);
  // tweet GIF
  socket.on('tweet gif', tweetGIF);
});

function captureVideo () {
  if (captureIsBusy) {
    console.log("capture process running! try again later...");
  }else{

    captureIsBusy = true;

    gpio_helper.doCountdownAnimation();

    // delay because of LED animation
    setTimeout(function(){
      gpio_helper.stopGreen();
      gpio_helper.startBlinkingRed();
      gpio_helper.startBlinkingYellow();

      ffmpeg_helper.captureVideo();
    }, 1600);

  }
}

function tweetGIF () {
  //console.log("tweetGIF");

  // Load your image
  //var data = require('fs').readFileSync('./public/videos/video.gif');
  var b64content = fs.readFileSync("./public" + gifpath, { encoding: 'base64' })

  // first we must post the media to Twitter
  T.post('media/upload', { media_data: b64content }, function (err, data, response) {

    // now we can reference the media and post a tweet (media will attach to the tweet)
    var mediaIdStr = data.media_id_string
    var params = { status: '#GIF_it_to_me', media_ids: [mediaIdStr] }

    T.post('statuses/update', params, function (err, data, response) {
      console.log("tweeted image succesful via @fork_tessel");
      io.emit('gif tweeted');
    })
  })
}

function fetchGIFs () {
  console.log('fetch gifs');

  // Walker options
  var files   = [];
  giffiles = [];
  var walker  = walk.walk('./public/images/gif', { followLinks: false });

  walker.on('file', function(root, stat, next) {
      files.push(root + '/' + stat.name);
      next();
  });

  walker.on('end', function() {
      for (var i = 0; i < files.length; i++) {
        var str = files[i];
        var strEdit = str.replace("./public", "");
        giffiles.push(strEdit);
      }
      io.emit("gifs fetched", giffiles);
  });
}




// wait for CTRL+C
process.on('SIGINT', shutdownAll);


function shutdownAll () {
  console.log("shutting down");

  gpio_helper.stopBlinkingRed();
  gpio_helper.stopBlinkingYellow();

  gpio_helper.doStopAnimation();

  setTimeout(kill, 650);
}

function kill () {
  process.exit(0);
}
