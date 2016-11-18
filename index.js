// BASE SETUP
// =============================================================================

// the packages we need
var express    = require('express');        // call express

// loading custom functions
require('./utils');

var app        = express();                 // define our app using express

// LOAD MODELS
// =============================================================================

var mongoose     = require('mongoose');

// Use native promises
mongoose.Promise = global.Promise;

var Schema     = mongoose.Schema;

var csvSchema = new Schema({ slug:  String, name: String, url: String, columns: [ { name: String }] }, { strict: false });
var CsvModel = mongoose.model('csv', csvSchema);

var itemSchema = new Schema({ base: String }, { strict: false });
var ItemModels = [];


// READ CONFIG
// =============================================================================
var config = undefined;
try {

  config = JSON.parse(process.env.CONFIG !== undefined ? process.env.CONFIG : readFile("config.json"));

console.log(config);

  if (config !== undefined && config.hasOwnProperty('base')) {
    console.log("********************************************************************************");
    console.log("Loaded configs:");
    console.log(config);
    console.log("********************************************************************************");
  } else {
    throw new Exception();
  }
} catch (e) {
  console.log("CRITICAL ERROR! Couldn't load config.json!");
  console.log(e);
  console.log("Application will exit.");
  process.exit();
}

var base = config.base;

var database = config.database;
mongoose.connect(database);

// ROUTES FOR OUR API
// =============================================================================
var router = express.Router();              // get an instance of the express Router

router.get('/', function(req, res) {
    res.json({ message: 'Hooray! Welcome to our api! Coming soon a complete documentation' });   
});

if (base.hasOwnProperty('csv') && base.csv.length > 0) {
  for(var i = 0; i < base.csv.length; i++) {
    var csv = base.csv[i];
    if (csv.hasOwnProperty('slug')) {

      if (!ItemModels.hasOwnProperty(csv.slug)) {
        ItemModels[csv.slug] = mongoose.model(csv.slug, itemSchema);
      }

      var ItemModel = ItemModels[csv.slug];

      router.get('/' + csv.slug, function(req, res) {
          res.json( base );   
      });

      router.get('/' + csv.slug + '/item', function(req, res) {
        var find = (req.query.find) ? JSON.parse(req.query.find) : {};
        find["base"] = csv.slug;
        ItemModel.findOne(find, function (err,item) {
          if (err) {
            res.json(false);   
          } else {
            res.json(item);   
          }
        })
      });

      router.get('/' + csv.slug + '/items', function(req, res) {
        var find = (req.query.find) ? JSON.parse(req.query.find) : {};
        find["base"] = csv.slug;
        var options = {};
        if (req.query.limit) options['limit'] = req.query.limit;
        if (req.query.order) options['order'] = req.query.order;
        if (req.query.skip) options['skip'] = req.query.skip;
        ItemModel.find(find, options, function (err,items) {
          if (err) {
            res.json(false);   
          } else {
            res.json(items);   
          }
        })
      });

      router.get('/' + csv.slug + '/fields', function(req, res) {
        var find = {};
        find["slug"] = csv.slug;
        CsvModel.findOne(find, function(err,doc) {
          if (err) {
            res.json(false);   
          } else {
            res.json(doc.columns);   
          }
        })
      });

      router.get('/' + csv.slug + '/:field', function(req, res) {
        ItemModel.find().distinct(req.params.field, function(err, values) {
          if (err) {
            res.json(false);   
          } else {
            res.json(values);   
          }
        });
      });

    }
  }
}


// ROUTES FOR OUR API
// =============================================================================
var fs = require('fs')
  , util = require('util')
  , stream = require('stream')
  , request = require('request')
  , es = require('event-stream');

router.get('/sync', function(req, res) {

  var lineNr = 0;
  if (base.hasOwnProperty('csv') && base.csv.length > 0) {
    for(var i = 0; i < base.csv.length; i++) {
      var csv = base.csv[i];

      if (csv.hasOwnProperty('url')) {
        var url = csv.url;

        var separator = (csv.hasOwnProperty('separator')) ? csv.separator : ';';
        var line_validator = (csv.hasOwnProperty('line_validator')) ? csv.line_validator : /^[-\s]+$/g;

        var columns = [];
        var items = [];

        CsvModel.findOneAndUpdate(
          { 'slug' : csv.slug },
          csv,
          { 'new': true, 'upsert': true },
          function(err, csv) {
            if (err) {
              console.log(err);
              //TODO
            }

            if (!ItemModels.hasOwnProperty(csv.slug)) {
              ItemModels[csv.slug] = mongoose.model(csv.slug, itemSchema);
            }

            var ItemModel = ItemModels[csv.slug];
            ItemModel.remove({ base: csv.slug }, function(err) {
              if (err) {
                console.log(err);
                //TODO
              }

              var s = request({url: url})
                .pipe(es.split())
                .pipe(es.mapSync(function(line){

                  // pause the readstream
                  s.pause();

                  lineNr += 1;

                  // process line here and call s.resume() when rdy
                  // function below was for logging memory usage
                  line = line.trim();

                  if (columns.length == 0 && line.length > 0) {
                    var column_names = line.split(separator);
                    for(var j = 0; j < column_names.length; j++) {
                      var column_name = column_names[j];

                      columns.push({ name: column_name});
                    }

                    csv.columns = columns;
                    csv.save();

                  } else {

                    var field_values = line.split(separator);

                    if (field_values.length > 0 && !line_validator.test(field_values[0])) {
                      var item = { base: csv.slug };

                      for(var j = 0; j < field_values.length; j++) {
                        item[columns[j].name] = field_values[j].trim();
                      }

                      items.push(item);
                      itemObj = new ItemModel(item);
                      itemObj.save();
                    }

                  }

                  if (config.hasOwnProperty('max_parsing_lines') && lineNr >= config.max_parsing_lines) s.close();

                  // resume the readstream, possibly from a callback
                  s.resume();
                })
                .on('error', function(e){
                  res.json({ success: false, columns: columns, nb_items: items.length, message: 'Error while reading file.' + e });   
                  console.log('Error while reading file.',e);

                })
                .on('end', function(){
                  res.json({ success: false, columns: columns, nb_items: items.length});   
                  console.log('Read entire file.')
                })
              );

            });

          }
        );
      }
    }
  }
});

// REGISTER OUR ROUTES -------------------------------
// all of our routes will be prefixed with /api
app.use('/', router);

// START THE SERVER
// =============================================================================
var port = config.hasOwnProperty('port') ? config.port : 8080;        // set our port
app.listen(port);
console.log('Magic happens on port ' + port);

