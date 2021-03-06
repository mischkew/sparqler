/*!
 * @author Nico Ring ringnico@web.de
 * @author Sven Mischkewitz sven.mkw@gmail.com
 */

var Request = require("request");
var Querystring = require("querystring");
var _ = require("lodash");
var SparqlerQuery = require("./query");

// fake of `String.prototype.contains` which is available at ECMAScript6
if ( !String.prototype.contains ) {
  String.prototype.contains = function() {
    return String.prototype.indexOf.apply( this, arguments ) !== -1;
  };
}
  
/**
 * SPARQL Endpoint Client. Creates and executes queries.
 * The response is formatted in Json.
 */

var defaults = {
  request: {
    method: "GET",
    encoding: "utf8",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    }
  },
  queryParams: {
    format: "application/sparql-results+json",
    timeout: 30000
  },

  // rdf prefixes, look them up at `prefix.cc`
  prefixes: {
    "rdf"        : "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "rdfs"       : "http://www.w3.org/2000/01/rdf-schema#",
    "owl"        : "http://www.w3.org/2002/07/owl#",
    "dbo"        : "http://dbpedia.org/ontology/",
    "dbpedia-owl": "http://dbpedia.org/ontology/",
    "dbprop"     : "http://dbpedia.org/property/",
    "dbpedia"    : "http://dbpedia.org/resource/",
    "foaf"       : "http://xmlns.com/foaf/0.1/",
    "geo"        : "http://www.w3.org/2003/01/geo/wgs84_pos#",
    "voy"        : "http://localhost/wikivoyage/",
    "voyont"     : "http://localhost/wikivoyage/vocabulary#",
    "vcard"      : "http://www.w3.org/2006/vcard/ns#",
    "travel"     : "http://protege.cim3.net/file/pub/ontologies/travel/travel.owl#",
    "acco"       : "http://purl.org/acco/ns#",
    "h"          : "http://wafi.iit.cnr.it/angelica/Hontology.owl#",
    "gr"         : "http://purl.org/goodrelations/v1#",
    "opener"     : "http://tour-pedia.org/resource/",
    "dcterms"    : "http://purl.org/dc/terms/"
  }
};

/**
* @param {String} endpoint
* @param {Object} options  object with options, formatted like `{ request : { "..." : "..." } }`
*/
function Sparqler(endpoint, options) {
  options = options || {};

  // load defaults
  this.prefixes = _.extend(defaults.prefixes, options.prefixes || {});
  this.requestOptions = _.extend(defaults.request, { url: endpoint }, options.request || {});
  this.queryParams = _.extend(defaults.queryParams, options.queryParams || {});

  // build a wrapper function which holds the default params for request
  this.Request = Request.defaults(this.requestOptions);
}

/*! ################# General Methods #################
 * These methods are essential for every executed query.
 */

/**
 * Return list of PREFIXES for the query.
 * @param  {String} query       A SPARQL query
 * @return {String}             prefix string
 */
Sparqler.prototype.parsePrefixes = function(query) {
  return _.reduce(this.prefixes, function(_query, prefix, key) {
      if (query.contains(key)) {
        _query += "PREFIX " + key + ": <" + prefix + "> \n";
      }

      return _query;
    }, "");
};

/**
 * Execute a query and a callback on success.
 *
 * @param  {String}   query    Parsed querystring without placeholders and without prefixes.
 * @param  {Function} callback
 */
Sparqler.prototype.execute = function(query, callback) {

  function errorHandler(callback) {
    return function(error, response, body) {
      if (!error && response.statusCode === 200) {
        callback(body);
      } else {
        console.error("Sparql query failed!", error, body);
      }
    };
  }

  query = this.parsePrefixes(query) + query;
  
  // perform update on INSERT or DELETE
  var queryParams;
  if (!query.contains("INSERT DATA") && !query.contains("DELETE")) {
    queryParams = _.extend(this.queryParams, { query: query });
  }
  else {
    queryParams = _.extend(this.queryParams, { update: query });
  }

  // the requestBody includes the defaultParameters and the query
  var opts = {
    qs: queryParams
  };

  callback = errorHandler(callback);
  this.Request(opts, callback);
};

/**
 * Creates a SparqlerQuery
 *
 * {String} query a sparql query
 */
Sparqler.prototype.createQuery = function(query) {
  return new SparqlerQuery(this, query);
};

/**
 * Filter only for values in the SPARQL/JSON response.
 *
 * @param {String} sparqlJson SPARQL/JSON response
 * @return {Object} filtered response object
 */
Sparqler.prototype.sparqlFlatten = function(sparqlJson) {
  var results = JSON.parse(sparqlJson).results.bindings;

  var flatResults = _.map(results, function(binding) {
    return _.mapValues(binding, "value");
  });

  return flatResults;
};

/*! ################# Special Methods #################
 * These methods are shortcuts for actual performed queries.
 */

/**
* Requests all data for the resource
*
* @param {String} resource must be a String of the resource, the prefix `dbr:` will be prepended
* @param {Function} callback Callback which is executed after the query
* @return {Json} the body of the respond
*/
Sparqler.prototype.getResource = function(resource, callback) {
  var query = "select * where { dbpedia:$resource ?p ?o }";
  var sQuery = this.createQuery(query);

  sQuery
    .setParameter("resource", resource)
    .execute(callback);
};

/**
* Requests all types of the resource
*
* @param {String}  resource must be a String of the resource, the prefix `dbpedia:` will be prepended
* @param {Function} callback Callback which is executed after the query
* @return {Json} the body of the respond
*/
Sparqler.prototype.getTypesOf = function(resource, callback) {
  var query = "select ?o where { dbpedia:$resource rdf:type ?o }";
  var sQuery = this.createQuery(query);

  sQuery
    .setParameter("resource", resource)
    .execute(callback);
};

/**
 * Get all objects which are the same as  `resource`.
 *
 * @param {String} resource Resource name
 * @param {Function} callback Callback which is executed after the query
 */
Sparqler.prototype.getSameAs = function (resource, callback) {
  var query = "select ?o where { $resource owl:sameAs ?o }";
  var sQuery = this.createQuery(query);

  sQuery
    .setParameter("resource", resource)
    .execute(callback);
};

/**
 * Get all resources inside a given rectangular bounding box
 *
 * @param {Object} bbox Boundingbox object, must contain: north, west, south, east
 * @param {Function} callback Callback which is executed after the query
 */
Sparqler.prototype.getResourcesInBBox = function(bbox, callback) {
  var query = "select * where { ?r geo:lat ?lat ; geo:long ?long . filter ( ?lat < $north && ?lat > $south && ?long < $east && ?long > $west ) } ";
  var sQuery = this.createQuery(query);

  sQuery
    .setParameter("north", bbox.north)
    .setParameter("west", bbox.west)
    .setParameter("south", bbox.south)
    .setParameter("east", bbox.east)
    .execute(callback);
};

/**
 * Helper function which builds a squared bbox from a position and a radius
 * 
 * @param  {Number} lat    latitude
 * @param  {Number} lng    longitude
 * @param  {Number} radius radius in according format to `lat` and `lng`
 * @return {Object}        Bounding Box object containing `north`, `south`, `west`, `east` keys
 */
Sparqler.prototype.getBBox = function(lat, lng, radius) {
  return {
    'north': lat + radius,
    'west': lng - radius,
    'south': lat - radius,
    'east': lng + radius
  };
};

module.exports = Sparqler;
