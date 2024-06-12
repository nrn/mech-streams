
const cmds = {}

function register (name, fn) {
  cmds[name] = fn
}

function run (tree) {
  let consumed = -1
  let origin = source = new MapStream()
  while (consumed < tree.length) {
    consumed+=1
    let next = tree[consumed]
    if (next == null) {
      if (source.pipe) {
        source = source.pipe(devnull())
      }
      return origin
    }
    if (next.cmd in cmds) {
      let children = []
      if (Array.isArray(tree[consumed+1])) {
        consumed += 1
        children = tree[consumed]
      }
      source = source.pipe(cmds[next.cmd](next, children, run))
    }
  }
  return origin
}

function once (v) {
  let stream = base()
  stream.resume = function () {
    this.sink.write(v)
    this.end()
  }
  return stream
}

function devnull () {
  let stream = base()

  stream.paused = false

  return stream
}

// streams stuff largely taken from https://github.com/dominictarr/push-streams-talk
// one difference is not really distinqusing 
//
// thse functions not used ATM
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

// non-class implementation
function base () {
  return {
    paused: true,
    ended: false,
    sink: null,
    source: null,
    resume: function () {
      if(!(this.paused = this.sink.paused) && this.source) {
        this.source.resume()
      }
    },

    write: function (data) {
      if (this.sink) {
        this.paused = this.sink.paused
      }
    },

    pipe: function (sink) {
      this.sink = sink
      sink.source = this
      if (!sink.paused) this.resume()
      return sink
    },
    
    abort: function (err) {
      if (this.source) this.source.abort(err)
      else this.end(err)
    },

    end: function (err) {
      this.ended = true
      this.paused = true
      if (this.sink) {
        this.sink.end(err)
      }
    }
  }
}

function mapStream (fn) {
  const stream = base()
  stream.write = function (data) {
    var self = this
    self.paused = true
    fn.call(this, data, function (err, mapped) {
      self.paused = false
      if (err) return self.sink.end(self.ended = err)
      self.sink.write(mapped)
      self.resume()
    })
  }
  return stream
}

function asyncMapStream (fn) {
  const stream = base()
  stream.write = function (data) {
    var self = this
    self.paused = true
    fn.call(this, data, function (err, mapped) {
      self.paused = false
      if (err) return self.abort(err)
      self.sink.write(mapped)
      self.resume()
    })
  }
  return stream
}


// Class implementation
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
      this.sink.write(fn.call(this,data))
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
      fn.call(this, data, function (err, mapped) {
        self.paused = false
        if (err) return self.abort(err)
        self.sink.write(mapped)
        self.resume()
      })
    }
  }
}

test()
function test () {
  register('log', function (cmd) {
    return new MapStream(function (data) { 
      console.log(data)
      return data
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
      let child = run(children)
      setTimeout(function () {
        child.abort()
        next(null, data)
      }, cmd.val * 1000)
    })
  })

  register('values', function (cmd) {
    var i = 0
    let values = new Base() 
    let it = cmd.val[Symbol.iterator]()
    values.resume = function () {
      while (!this.sink.paused && !this.ended) {
        let step = it.next()
        if (step.done) this.end()
        else this.sink.write(step.value)
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
        }, 100)
      } else {
        this.sink.end()
      }
    }
    return repeat
  })
  
  register('tee', function (cmd, children, run) {
    let running = run(children)
    return new MapStream(function (data) {
      running.write(data)
      return data
    })
  })

  register('limit', function (cmd) {
    let i = 0
    return new AsyncMapStream(function (data, next) {
      i++
      if (i > cmd.val) {
        next(true)
      } else {
        next(null, data)
      }
    })
  })

  function* count () {
    let i = 0
    while (true) {
      yield i;
      i++
    }
    return i
  }

  run([
    { cmd: 'values', val: count() },
    { cmd: 'sum', val: 1},
    { cmd: 'tee' },
    [
      { cmd: 'sum', val: 100 },
      { cmd: 'log' }
    ],
    { cmd: 'limit', val: 4 },
    { cmd: 'sleep', val: 2 },
    { cmd: 'sum', val: 3},
    { cmd: 'log' },
    { cmd: 'sleep', val: 2 },
    [ 
      { cmd: 'repeat', val: 'hello' },
      { cmd: 'log' }
    ],
    { cmd: 'sum', val: 7},
    { cmd: 'log' }
  ])
}