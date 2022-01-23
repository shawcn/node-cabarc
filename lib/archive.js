
var Cabinet = require( './cabinet' )
var async = require( './async' )
const {Buffer} = require("buffer");

/**
 * Archive
 * @constructor
 * @memberOf Cabinet
 * @returns {Archive}
 */
function Archive() {

  if( !(this instanceof Archive) )
    return new Archive()

  this.blob = null
  this.buffer = null

  this.header = new Cabinet.Header()

}

/**
 * Archive prototype
 * @type {Object}
 * @ignore
 */
Archive.prototype = {

  constructor: Archive,

  readHeader( callback ) {

    var offset = 0
    var length = 64 * 1024

    const buffer = Buffer.from(this.buffer.slice(offset, offset + length).arrayBuffer());
    this.header.parse( buffer )
    callback.call( this, null, this.header )
  },

  readFileList( callback ) {

    var length = Cabinet.File.MAX_SIZE
    var buffer = Buffer.alloc( length )
    var position = this.header.fileOffset
    var offset = 0

    var fileIndex = 0
    var files = []

    async.whilst(
      () => { return fileIndex < this.header.fileCount },
      ( next ) => {

        const buffer = Buffer.from(this.buffer.slice(position, position + length).arrayBuffer());

        const file = Cabinet.File.parse( buffer )
        files.push(file)

        fileIndex += 1
        position += file.encodingLength()

        next()
      },
      ( error ) => {
        this.files = files
        callback.call( this, error, files )
      }
    )

  },

  readFolder( folderIndex, callback ) {

    var length = Cabinet.Folder.SIZE + this.header.folderData
    var position = this.header.byteLength + ( folderIndex * length )
    var offset = 0

    const buffer = Buffer.from(this.buffer.slice(position, position+length));

    if( buffer.byteLength !== length) {
      const error = new Error( `Bytes read mismatch; expected ${length}, read ${buffer.byteLength}` )
      return void callback.call( this, error )
    }

    var folder = null

    try {
      folder = Cabinet.Folder.parse( buffer )
    } catch( e ) {
      return void callback.call( this, e )
    }

    callback.call( this, null, folder )

  },

  readFile( filename, callback ) {

    // NOTE: To maintain compatibility between operating systems,
    // we normalize the path to Windows path conventions, as the
    // Cabinet Archive format originated there

    filename = filename.toLowerCase();

    const file = this.files.find(( file ) => {
      return file.name.toLowerCase() === filename
    })

    // console.log( 'File:', file, '\n' )

    if( file == null ) {
      var error = new Error( 'ENOENT: no such file or directory' )
      error.code = 'ENOENT'
      error.errno = 404
      error.path = filename
      return void callback.call( this, error )
    }

    this.readFolder( file.folderIndex, ( error, folder ) => {

      if( error ) {
        return void callback.call( this, error )
      }

      if( ( folder.compressionType & 0xFF ) !== Cabinet.COMPRESSION.NONE ) {
        return void callback.call( this, new Error( `Compression not supported` ) )
      }

      // console.log( 'Folder:', folder, '\n' )

      var length = Cabinet.Data.MAX_SIZE
      var blockBuffer = Buffer.allocUnsafe( length )
      var position = folder.dataOffset
      var blockIndex = 0

      var buffers = []

      async.whilst(
        () => { return blockIndex < folder.blockCount },
        ( next ) => {

          blockBuffer.fill( 0 )

          var offset = 0

          const blockBuffer = Buffer.from(this.buffer.slice(position, position + length))

          try{
            const block = new Cabinet.Data( this.header.blockData ).parse( blockBuffer )

            position += Cabinet.Data.SIZE + this.header.blockData + block.compressedLength
            blockIndex += 1

            buffers.push( block.data )

            next()
          } catch( e ) {
            return void next( e )
          }

        },
        ( error ) => {
          // TODO: Decompress & write to fileBuffer while reading blocks,
          // instead of reading the entire folder into memory
          var buffer = Buffer.concat( buffers )
          var fileBuffer = Buffer.alloc( file.size )
          buffer.copy( fileBuffer, 0, file.folderOffset, file.folderOffset + file.size )
          callback.call( this, error, fileBuffer )
        }
      )

    })

  },

  // TODO: Don't read structures on open(),
  // to facilitate creating archives from scratch
  // Create & use .ls() to read folders & files
  open( buffer, callback ) {

    if(!buffer instanceof ArrayBuffer) {
      throw new Error('ArrayBuffer only!');
    }

    if( this.buffer != null ) {
      this.close( ( error ) => {
        if( error ) return callback.call( this, error )
        this.open( buffer, callback )
      })
    }

    this.buffer = buffer;

    const tasks = [
      ( next ) => this.readHeader( next ),
      ( next ) => this.readFileList( next ),
    ]

    const run = ( error ) => {
      if( error ) return callback.call( this, error )
      const task = tasks.shift()
      task ? task( run ) : callback.call( this )
    }

    run()

    return this

  },

  close( callback ) {

    if( this.buffer == null ) {
      return callback.call( this )
    }

    this.buffer = null

  },

  createReadStream( filename, options ) {
    throw new Error( 'Not implemented' )
  },

}

module.exports = Archive
