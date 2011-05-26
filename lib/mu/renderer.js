var EventEmitter = require('events').EventEmitter
var util = require('util')
var Stream = require('stream').Stream

var cache = null // this will be replaced, on loading mu.js, with the actual cache
exports.setCache = function(mu_cache) {
  cache = mu_cache
}
  

function _escapeReplaceHtml(s) {
  switch (s) {
    case '<': return '&lt;'
    case '>': return '&gt;'
    case '&': return '&amp;'
    case '"': return '&quot;'
    default: return s
  }
}

function escape(s) {
  return s.replace(/[&<>"]/g, _escapeReplaceHtml)
}

// function to_s(val) {
//   return typeof val === 'undefined' ? '' : val.toString()
// }

// function resolve(context, name, arguments) {
//   var val = context[name]
//   if (typeof(val) === 'function') {
//     val = context[name](arguments)
//   }
//   return val
// }

// var baseProto = ({}).__proto__
// function _insertProto(obj, newProto, replaceProto) {
//   replaceProto = replaceProto || baseProto
//   var proto = obj.__proto__
//   while (proto !== replaceProto) {
//     obj = proto
//     proto = proto.__proto__
//   }
//   obj.__proto__ = newProto
//   return obj
// }
    
function copyProperties(from, to) {
  for (attr in from) {
    to[attr] = from[attr]
  }
  return to
}

var Controller = exports.Controller = function(renderer) {
  this.renderer = renderer
}
Controller.prototype = new EventEmitter
Controller.prototype.add = function(name, value) {
  this.renderer.context[name] = value
  console.log('added ' + name + ', bumping... now have: ' + util.inspect(this.renderer.context))
  this.emit('bump')
}
Controller.prototype.extend = function(dictionary) {
  // copyProperties(dictionary, this.renderer.context)
  for (attr in dictionary) {
    this.renderer.context[attr] = dictionary[attr]
  }
  this.emit('bump')
}
Controller.prototype.force = function() {
  this.renderer.asap = false
  this.emit('bump')
}


var Renderer = exports.Renderer = function(asap) { 
  this.asap = asap !== undefined ? asap : false
  // this.cache = cache // this is just a reference to the mu global cache. is there a better way to get it here?
  this.controller = new Controller(this)
  this.context = {}
}


Renderer.prototype = {
  /**
   * Renders the previously parsed filename or the parsed object.
   *
   * @param {Array} names The filenames (cache keys) of the cached templates to use, ['grandparent', 'parent', 'child']
   * @param {Object} context The data to use when rendering.
   * @param {Object} cache The cache from which to retrieve partials/layouts.
   * @param {Stream} stream The stream to output everything to.
   * @param {Function} callback What to call when we're done.
   *
   * @returns {Nothing} But that's okay because it's triggered in a process.nextTick.
   * @throws {Error(template_not_in_cache)} If filename was not found in cache.
   */
  render: function(names, context, stream, callback) {
    var tokens = cache.hitSync(names[0])
    for (attr in context) { 
      this.context[attr] = context[attr]
    }
    return this.subrender(tokens, names.slice(1), this.context, stream, callback)
  },
  subrender: function(tokens, next_names, context, stream, callback) {
    renderer = this

    // if (tokens[0] !== 'multi') {
    //   throw new Error('Mu - WTF did you give me? I expected mustache tokens.')
    // }
    
    var i = 1
    
    function next() {
      try {
        if (stream.paused) {
          stream.on('drain', function () {
            process.nextTick(next)
          })
          return
        }
    
        var token = tokens[i++]
    
        if (token === undefined) {
          // we're done!
          return callback ? callback() : true
        }
      
        // token = [<static/mustache>, <tag>, (<content>,) (<content2>)]
        var content = token[2]
        if (token[0] === 'static') {
          stream.emit('data', content)
          return next()
        }
        else { // 'mustache'
          var tag = token[1]
          if (tag === 'partial') {
            // partials cannot have inheritance, for the moment (would be easy to add), so rendering is simple:
            return renderer.render([content], context, stream, next)
          }
          else if (tag === 'yield') {
            if (next_names[0] === undefined)
              throw new Error('Cannot yield nothing')
            return renderer.render(next_names, context, stream, next)
          }
          else {
            // resolve, whether or not its a function
            (function bump() {
              var res = context[content]
              // console.log("rendering section item with: " + util.inspect(item, true, null))
              if (typeof(res) === 'function') {
                res = res(token[3])
              }
              
              if (res === undefined) {
                // this.asap can be true if we want to wait, and false if we merely want to ignore the missing context vars.
                if (renderer.asap) {
                  renderer.controller.once('bump', bump) // wait
                  console.log('waiting for bump, need: ' + content + '; have: ' + util.inspect(context))
                  return
                }
                else {
                  // console.log("!!!Ignoring missing context var!!!")
                  res = ''
                }
              }
              
              if (tag === 'utag' || tag === 'etag') {
                res = res.toString()
                if (tag === 'etag')
                  res = escape(res)
                stream.emit('data', res)
                return next()
              }
              else if (tag === 'section' || tag === 'inverted_section') {
                console.log("Processing section, res: " + util.inspect(res) + " -- token[4]: " + util.inspect(token[4]))
                var enabled = tag === 'inverted_section' ? !res : res
                if (enabled)
                  return renderer.section(context, content, res, token[4], stream, next)
                else
                  return next()
              }
            })() // run it now, but make it a function so that I can re-run it later, too.
          }
        }
      } catch (err) {
        console.log(stream instanceof Stream)
        console.log(util.inspect(stream))
        stream.emit('error', err)
        next()
      }
    }
    next()
  },
  // not supposed to be used publicly, though.
  section: function (context, name, val, tokens, stream, callback) {
    // var val = resolve(context, name, body)
  
    // if (typeof val === 'boolean') {
    //   return val ? render(tokens, context, cache, stream, callback) : callback()
    // }
    console.log("in section fn: " + util.inspect(val, true, null))
    if (val instanceof Array) {
      var i = 0
      function next() {
        // if (item) {
          // var proto = _insertProto(item, context)
          // (tokens, next_names, context, stream, callback)
          
          // function () {
            // proto.__proto__ = baseProto
            // next()
          // })
        // } else {
        //   callback()
        // }

        var item = val[i++]
        copyProperties(context, item)
        console.log("rendering section item with: " + util.inspect(item, true, null))
        return renderer.subrender(tokens, [], item, stream, i >= val.length ? callback : next)
      }
      return next()
    } 
    else if (typeof val === 'object') {
      // var proto = _insertProto(val, context)
      // proto.__proto__ = baseProto
      // return
      var item = val
      return renderer.subrender(tokens, [], item, stream, callback)
    }
    else if (val) {
      var item = context
      return renderer.subrender(tokens, [], item, stream, callback)
    }
    return callback()
  }
}



//
//
//
// function findInContext(context, key) {
//   var i = context.length
//   while (i--) {
//     if (context[i][key]) {
//       return context[i][key]
//     }
//   }
// 
//   return undefined
// }

