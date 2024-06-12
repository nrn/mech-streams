
const cmds = {}

function register (name, fn) {
  cmds[name] = fn
}

function run (tree) {
  let consumed = -1
  let origin = source = new MapStream()
  while (consumed < tree.length) {
    consumed+=1
    console.log(consumed)
    let next = tree[consumed]
    if (next == null) {
      console.log('all consumed')
      if (source.pipe) {
        source = source.pipe(devnull())
      }
      return source
    }
    if (next.cmd in cmds) {
      let children = []
      if (Array.isArray(tree[consumed+1])) {
        consumed += 1
        children = tree[consumed]
      }
      source = source.pipe(cmds[next.cmd](next, children, run))
      console.log(source)
    }
  }
  return origin
}

function once (v) {
  return {
    resume: function () {
      this.sink.write(v)
      this.sink.end()
    },
    end: throughEnd,
    abort: abort,
    sink: null,
    pipe: pipe
  }
}

function devnull () {
  return {
    write: function (data) {
      console.log('devnull', data)
    },
    pause: false,
    abort: abort,
    end: function (err) {
      this.ended = err || true
      if (err) console.error(err)
    }
  }
}

// streams stuff largely taken from https://github.com/dominictarr/push-streams-talk
function pipe (sink) {
  this.sink = sink
  sink.source = this
  if (!sink.paused) this.resume()
  return sink
}

function abort (err) {
  this.paused = true
  if (this.source) this.source.abort(err)
  else this.end(err)
}

function throughEnd (err) {
  this.ended = true
  this.sink.end(err)
}

function throughResume () {
  if(!(this.paused = this.sink.paused)) {
    this.source.resume()
  }
}

class Base {
  paused = true;
  ended = false;
  sink = null;
  source = null;

  resume () {
    if(!(this.paused = this.sink.paused) && this.source) {
      this.source.resume()
    }
  }

  write (data) {
    if (this.sink) {
      this.paused = this.sink.paused
    }
  }

  pipe (sink) {
    this.sink = sink
    sink.source = this
    if (!sink.paused) this.resume()
    return sink
  }
  
  abort (err) {
    this.paused = true
    if (this.source) this.source.abort(err)
    else this.end(err)
  }

  end (err) {
    this.ended = true
    this.sink.end(err)
  }
}

class MapStream extends Base {
  constructor (fn) {
    super()
    if (fn == null) {
      fn = function (a) { return a }
    }
    this.write = function (data) {
      this.sink.write(fn(data))
      this.paused = this.sink.paused
    }
  }
}

class AsyncMapStream extends Base {
  constructor (fn) {
    super()
    this.write = function (data) {
      var self = this
      self.paused = true
      fn(data, function (err, mapped) {
        self.paused = false
        if (err) return self.sink.end(this.ended = err)
        self.sink.write(mapped)
        self.resume()
      })
    }
  }
}

// How ot make a map w/o classes
// function map (fn) {
//   return {
//     write: function (data) {
//       this.sink.write(fn(data))
//       this.paused = this.sink.paused
//     },
//     end: throughEnd,
//     abort: abort,
//     paused: true,
//     resume: throughResume,
//     pipe: pipe
//   }
// }

let a = 1

test()
function test () {
  register('log', function (cmd) {
    return new MapStream(function (i) { 
      console.log(arguments)
      return i
    })
  })

  register('sum', function (cmd) {
    return new MapStream(function (i) { 
      if (typeof i !== 'number') i = 0
      return i + cmd.val
    })
  })

  register('sleep', function (cmd, children, run) {
    return new AsyncMapStream(function (data, next) {
      const childPipes = children.map(function (child) {
        return run([child])
      })
      setTimeout(function () {
        childPipes.forEach(function (child) { 
          console.log(child)
          child.abort()
        })
        next(null, data)
      }, cmd.val * 1000)
    })
  })

  register('tee', function (cmd, children, run) {
    return new MapStream(function (data) {
      const childPipes = children.map(function (child) {
        return run([child])
      })
      childPipes.forEach(function (child) {
        child.write(data)
      })
      return data
    })
    
  })

  register('values', function (cmd) {
    var i = 0
    let values = new Base() 
    values.resume = function () {
      while (!this.sink.paused && !this.ended) {
        if (this.ended = i >= cmd.val.length) this.sink.end()
        else this.sink.write(cmd.val[i++])
      }
    }
    return values
  })

  register('repeat', function (cmd) {
    let repeat = new Base()

    repeat.resume = function () {
      if (!this.sink.paused && !this.ended) {
        this.sink.write(cmd.val)
        let self = this
        setTimeout(function () {
          self.resume()
        }, 10)
      } else {
        this.sink.end()
      }
    }
    return repeat
  })


  // register('pulse', async function (cmd, input, children, run) {
  //   setInterval(function () {
  //     run(children, input)
  //   }, cmd.ms)
  //   return await run(children, input)
  // })


  run([
    { cmd: 'values', val: [ 1, 2, 3 ] },
    { cmd: 'sum', val: 1},
    { cmd: 'sleep', val: 2 },
    { cmd: 'sum', val: 3},
    { cmd: 'log' },
    { cmd: 'sleep', val: 2 },
    [ 
      { cmd: 'repeat', val: 'hello' },
      { cmd: 'repeat', val: 'goodbye' }
    ],
    { cmd: 'sum', val: 8},
    { cmd: 'log' }
  ])
}