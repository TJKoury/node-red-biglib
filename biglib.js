/*
  Copyright (c) 2016 Jacques W.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.

  This a Blue Node!

  /\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\
 
   Big Nodes principles:
 
   #1 can handle big data
   #2 send status messages on a second output (start, end, running, error)
   #3 visually tell what they are doing (blue: ready/running, green: ok/done, error)

   Any issues? https://github.com/Jacques44
 
  /\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\

*/

var fs = require('fs');
var domain = require('domain');
var stream = require('stream');
var moment = require('moment');
var filesize = require('filesize');
var callerId = require('caller-id');
var byline = require('byline');
const assert = require('assert');

const line_options = { "encoding": 'utf8', "keepEmptyLines": true };
const file_options = { 
  "encoding": 'utf8', start: undefined, end: undefined, 
  "highWaterMark": { default: 64, validation: function(v) { return v*1024 } }
}

'use strict';

function biglib(obj) {

	this.def_config = Object.assign({}, validate_config(obj.config));

  set_parser.call(this, obj.parser, obj.parser_config);

	this.node = obj.node;

  this.stack = [];
  this.last_rated_status = new Date();
  this.last_control_rated_send = new Date();

  delete this.def_config.wires;
  delete this.def_config.x;
  delete this.def_config.y;
  delete this.def_config.z;   

  this._blockMode = false;
  this.running = false;

  this.progress = function () { 
    switch (obj.status || 'filesize') {
      case 'filesize':
        return function() { return filesize(this.runtime_control.size) }
        break;
      case 'records': 
        return function() { return this.runtime_control.records + " records" }
        break;
      default:
        return function() { return "..." }
    }
  }();

	this.runtime_control = {
		  config: Object.assign({}, this.def_config)
	}	

  ready.call(this);
}

biglib.prototype.message_type = function(msg) {
  if (! msg.control) return this._blockMode ? 'block' : 'filename';

  if (msg.control.state == 'start') {
    this._blockMode = true;
  }
  else if (msg.control.state == 'end' || msg.control.state == 'error') {
    this._blockMode = false;
  }

  return 'control';
}

//
// Return true if in block flow mode
// otherwise, msg contains a filename
biglib.prototype.block_mode = function(msg) {
  return this._blockMode;
}

//
// Each node using this library may work in "file" mode
var set_parser = function(parser, parser_config) {
  try {
    if (parser == 'line') {
      this.parser_stream = function (myconfig) { 
        return new byline.LineStream(myconfig);
      }
      this.parser_config = line_options;
    }
    else {
      this.parser_stream = parser;
      this.parser_config = parser_config;
    }
  } catch (err) {
    console.log(err.message);
    throw err;
  }  
}

var validate_config = function(config) {
  config.checkpoint = config.checkpoint || 100;   
  config.status_rate = config.status_rate || 1000;
  config.control_rate = config.control_rate || 1000;

  return config;
}

biglib.prototype.new_config = function(config) {
	if (! config) config = Object.assign({}, this.def_config);
	return validate_config(config);
}

// 
// Helper function to pick only necessary properties
//
var extract_config = function(given_config, expected_keys) {

  try {
    var out_config = {};
    keys = 
      Array.isArray(expected_keys) ? expected_keys : ( 
        typeof expected_keys == 'object' ? Object.keys(expected_keys) : 
        [ expected_keys ]
      );

    for (i in keys) {
      var name = keys[i];
      var def = expected_keys[name];
      var validate = false;

      // If this expected configuration key is given, take it
      if (given_config.hasOwnProperty(name)) {
        out_config[name] = given_config[name];
        validate = true;
      } else {
        // Default value?
        if (expected_keys.hasOwnProperty(name)) {
          if (typeof def == 'object') {
            if (def.default) {
              out_config[name] = def.default; 
              validate = true;
            }
          } else {
            out_config[name] = def;
            validate = true;
          }
        }
      }

      if (validate && def && def.validation) {
        out_config[name] = def.validation(out_config[name]);
      }

    }
    return out_config;
  } catch (err) {
    console.log(err);
    throw err;
  }
}

// Require stream to close
var close_stream = function(input) {
  if (input) {
    input.end();
  } else {
    //this.log("damn, no input stream to close");
  }
  return;
}

var ready = function() {
  this.node.status({fill: "blue", shape: "dot", text: "ready !"});
}

var rated_status = function(msg) {
  var now = Date.now();
  if (now - this.last_rated_status > this.runtime_control.config.status_rate || 0) {
    this.node.status(msg);
    this.last_rated_status = now;
  }
}

var control_rated_send = function(cb) {
  var now = Date.now();
  if (now - this.last_control_rated_send > this.runtime_control.config.control_rate || 0) {
    this.node.send([ null, cb()]);
    this.last_control_rated_send = now;
  }
}      


biglib.prototype.log = function(msg) {
  var caller = callerId.getData();
  console.log("[" + this.node.constructor.name + "@" + caller.functionName + "] " + JSON.stringify(msg, null, 2));
}

// Principe #2, end message on output #2
var on_finish = function(err) {

  this.runtime_control.state = "end";
  this.runtime_control.message = "success";
  this.runtime_control.end = new Date();
  this.runtime_control.speed = 0;

  if (err) {
    this.runtime_control.state = "error";
    this.runtime_control.error = err;
    this.runtime_control.message = err.message;
    this.node.status({fill: "red", shape: "dot", text: err.message });
  } else {
    this.node.status({fill: "green", shape: "dot", text: "done with " + this.progress() });
  }

  this.node.send([ null, { control: this.runtime_control }]);

  this.running = false;

  if (err) this.node.error(err);
}

var on_start = function(config, control) {

  this.runtime_control.records = this.runtime_control.size = 0;
  this.runtime_control.start = new Date();
  this.runtime_control.speed = 0;
  this.runtime_control.control = control;  // parent control message
  this.runtime_control.config = config;
  delete this.runtime_control.end;
  this.runtime_control.state = "start";  
  this.runtime_control.message = "running...";

  this.node.send([ null, { control: this.runtime_control }]);   

  this.running = true; 
}

var out_stream = function(my_config) {

  var format = function(data) { return data }
  if (my_config.format) {
    format = function(data) { return data.toString(my_config.format) }
  }

  // 2. Sender
  var outstream = new stream.Transform( { objectMode: true });
  outstream._transform = (function(data, encoding, done) {

    rated_status.call(this, {fill: "blue", shape: "dot", text: "sending... " + this.progress() + " so far"});

    // #1 big node principle: send blocks for big files management
    this.node.send([{ payload: format(data) }]);

    done();
  }).bind(this);      

  return outstream;
}

// control is an incoming control message { control: {}, config: {} }
biglib.prototype.create_stream = function(msg, in_streams, last) {

  var my_config = (msg || {}).config || this.def_config;

  var input;
  var output;

  assert(this.runtime_control, "create_stream, no runtime_control");

  // Error management using domain
  // Everything linked together with error management
  // Cf documentation
  // Run the supplied function in the context of the domain, implicitly binding all event emitters, timers, and lowlevel requests that are created in that context
  domain.create()

    .on('error', on_finish.bind(this))

    .run((function() {
      output = input = in_streams.shift().call(this, my_config);

      in_streams.forEach((function(s) {
        output = output.pipe(s.call(this, my_config));
      }).bind(this));

      if (this.parser_stream) {

        output = output
          .pipe(this.parser_stream(extract_config(my_config, this.parser_config)))
          .pipe(record_stream.call(this, my_config));
      }

      output = output.pipe(out_stream.call(this, my_config));

      output.on('finish', on_finish.bind(this));

    }).bind(this));

  // Big node status and statistics
  on_start.call(this, my_config, msg.control);

  // Return is the entry point for incoming data
  return { input: input, output: output };
}

var speed_message = function() {
  var duration = moment.duration(moment().diff(this.runtime_control.start, 'seconds'));

  if (duration > 0) {         
    this.runtime_control.speed = this.runtime_control.size / duration;
    this.runtime_control.state = 'running';
    return { control: this.runtime_control };
  }      
}

var size_stream = function(my_config) {

  var biglib = this;
  assert(biglib.runtime_control, "size_stream, pas de runtime_control");

  // Streams are created in the scope of domain (very very important)
  var size_stream = new stream.Transform({ objectMode: true });
  size_stream._transform = (function(data, encoding, done) {
    biglib.runtime_control.size += data.length;

    this.push(data);

    control_rated_send.call(biglib, (speed_message).bind(biglib));

    done();
  });

  return size_stream;
}

var record_stream = function(my_config) {

  var biglib = this;
  assert(biglib.runtime_control, "record_stream, pas de runtime_control");

  // Streams are created in the scope of domain (very very important)
  var record_stream = new stream.Transform({ objectMode: true });
  record_stream._transform = (function(data, encoding, done) {
    biglib.runtime_control.records++;

    this.push(data);

    control_rated_send.call(biglib, (speed_message).bind(biglib));

    done();
  });

  return record_stream;
}

//
// private function
// build a stream from a file either as blocks or full content
// manages a stack of filenames
//
var stream_file_names = function() {

  return (function(arg_stream) {

    return (function(msg) {

      var next = (function() {
        var msg = this.stack.pop();
        if (msg) {
          this.log("next in the queue");
          create(msg);
        }
      }).bind(this);

      var create = (function(msg) {
        var s = []; if (arg_stream) s.push(arg_stream);
        s.push(size_stream);
        this.create_stream(msg, s).output.on('finish', next);
      }).bind(this);

      if (this.running) { 
      	this.log("Already running, push...");
        this.stack.push(msg);
      } else {
        create(msg);
      }

    }); 

  });

}();

//
// input message: filename
// output messages: data blocks (n blocks)
//
biglib.prototype.stream_file_blocks = function() {

  var input_stream = function(my_config) {

    // Documentation: https://nodejs.org/api/fs.html#fs_fs_createreadstream_path_options
    var config = extract_config(my_config, file_options);

    return fs.createReadStream(my_config.filename, config);
  }

  var input = stream_file_names(input_stream);

  return function(msg) {
    return input.call(this, msg); 
  }

}();

//
// input message: filename
// output messages: data blocks (n blocks)
// Documentation: https://www.npmjs.com/package/line-by-line
//
biglib.prototype.stream_data_lines = function(my_config) {

  var input_stream = function(my_config) {

    set_parser.call(this, 'line');

    // Documentation: https://nodejs.org/api/fs.html#fs_fs_createreadstream_path_options
    var config_file = extract_config(my_config, file_options);

    return fs.createReadStream(my_config.filename, config_file.encoding);
  }

  var input = stream_file_names(input_stream);

  return function(msg) {
    return input.call(this, msg); 
  }

}();

//
// input message: filename
// output message: file content (1 message)
biglib.prototype.stream_full_file = function(msg) {

  var input_stream = function(my_config) {

    var r = new stream.Readable();

    // Avoid Error: not implemented error message
    r._read = function() {}    

    var config = extract_config(my_config, file_options);

    fs.readFile(my_config.filename, config, (function(err, data) {
      if (err) throw err;
      this.push(data);
      this.push(null);
    }).bind(r));

    return r;
  }

  var input = stream_file_names(input_stream);

  return function(msg) {
    return input.call(this, msg); 
  }

}();

//
// input: data blocks
// output: data blocks
// acts as a transform stream
// manages start, end control messages
//
biglib.prototype.stream_data_blocks = function() {

  var input_stream;

  return (function(msg) {

    if (msg.control && msg.control.state == "error") {
      this.log("resending error message");
      this.node.send([ null, msg]);
      return;
    }

    if (msg.control && (msg.control.state == "start" || msg.control.state == "standalone")) {

      input_stream = close_stream.call(this, input_stream);

      ready.call(this);

      if (msg.config) input_stream = this.create_stream(msg, [ size_stream ]).input;
    }

    if (msg.payload) {
      if (! input_stream) input_stream = this.create_stream(msg, [ size_stream ]).input;

      input_stream.write(msg.payload);
    }

    if (msg.control && (msg.control.state == "end" || msg.control.state == "standalone")) {
      this.runtime_control.control = msg.control;    // Parent control message

      input_stream = close_stream.call(this, input_stream);
    }
  });

}();

biglib.prototype.config = function() {
	return this.runtime_control.config;
}

biglib.prototype.main = function(msg) {

  switch (this.message_type(msg)) {

    case 'block': 
    case 'control':
      this.stream_data_blocks(msg);     
      break;

    case 'filename': 
      msg.config = this.new_config(msg.config);

      msg.config.filename = msg.config.filename || msg.filename || msg.payload;
      this.stream_file_blocks(msg);
      break;
  }  
}

module.exports = biglib;
