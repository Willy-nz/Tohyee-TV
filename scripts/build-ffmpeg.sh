#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(pwd)"
BUILD_DIR="$ROOT_DIR/.build/ffmpeg"
PREFIX_DIR="$BUILD_DIR/prefix"
OUT_DIR="$ROOT_DIR/vendor/ffmpeg"
FFMPEG_REV=946fcce07b6dcd0331c8cc609192aeff5e1924f8
X264_REV=31e19f92f00c7003fa115047ce50978bc98c3a0d
mkdir -p "$BUILD_DIR" "$OUT_DIR" "$PREFIX_DIR"
curl -fL --retry 3 "https://github.com/FFmpeg/FFmpeg/archive/$FFMPEG_REV.tar.gz" -o "$BUILD_DIR/ffmpeg.tar.gz"
curl -fL --retry 3 "https://github.com/mirror/x264/archive/$X264_REV.tar.gz" -o "$BUILD_DIR/x264.tar.gz"
tar -xzf "$BUILD_DIR/ffmpeg.tar.gz" -C "$BUILD_DIR"
tar -xzf "$BUILD_DIR/x264.tar.gz" -C "$BUILD_DIR"
cd "$BUILD_DIR/x264-$X264_REV"
./configure --host=x86_64-w64-mingw32 --cross-prefix=x86_64-w64-mingw32- --prefix="$PREFIX_DIR" --enable-static --disable-cli --disable-opencl --disable-asm
make -j2
make install
cd "$BUILD_DIR/FFmpeg-$FFMPEG_REV"
export PKG_CONFIG_LIBDIR="$PREFIX_DIR/lib/pkgconfig"
./configure --target-os=mingw32 --arch=x86_64 --cross-prefix=x86_64-w64-mingw32- --pkg-config=pkg-config \
 --extra-cflags="-I$PREFIX_DIR/include" --extra-ldflags="-L$PREFIX_DIR/lib -static" \
 --enable-gpl --enable-libx264 --disable-autodetect --disable-doc --disable-debug --disable-shared --enable-static \
 --disable-network --disable-everything --enable-ffmpeg --enable-ffprobe \
 --enable-protocol=file,pipe --enable-demuxer=matroska,mov,mpegts,lavfi \
 --enable-muxer=mpegts,matroska,webm,null --enable-decoder=ffv1,h264,vp8,vp9,opus,aac,pcm_s16le,rawvideo,wrapped_avframe \
 --enable-encoder=ffv1,libx264,aac,pcm_s16le,wrapped_avframe --enable-parser=h264,vp8,vp9,opus,aac \
 --enable-filter=scale,fps,format,aformat,aresample,testsrc,testsrc2,sine,anull,null \
 --enable-indev=lavfi --enable-bsf=h264_mp4toannexb,extract_extradata,aac_adtstoasc --disable-x86asm
make -j2
cp ffmpeg.exe ffprobe.exe "$OUT_DIR/"
cp COPYING.GPLv2 "$OUT_DIR/FFMPEG-GPLv2.txt"
cp "$BUILD_DIR/x264-$X264_REV/COPYING" "$OUT_DIR/X264-GPLv2.txt"
cp "$ROOT_DIR/scripts/build-ffmpeg.sh" "$BUILD_DIR/build-ffmpeg.sh"
printf 'FFmpeg revision: %s\nx264 revision: %s\nBuild host: Ubuntu 24.04, gcc-mingw-w64-x86-64, make, pkg-config\n' "$FFMPEG_REV" "$X264_REV" > "$BUILD_DIR/BUILD-INFO.txt"
cp ffbuild/config.log "$BUILD_DIR/ffmpeg-config.log"
tar -czf "$OUT_DIR/Corresponding-Source.tar.gz" -C "$BUILD_DIR" ffmpeg.tar.gz x264.tar.gz build-ffmpeg.sh BUILD-INFO.txt ffmpeg-config.log
cat > "$OUT_DIR/README.txt" <<'NOTICE'
Tohyee TV uses FFmpeg with libx264 as a separate executable.
This build is licensed under GNU GPL version 2 or later. No nonfree components are enabled.
The full corresponding FFmpeg and x264 source archives, configuration recipe and build log are included in Corresponding-Source.tar.gz alongside this file. Extract both source archives to inspect or modify the code. The recipe downloads the same pinned revisions; for an offline rebuild, use the included source archives instead of the two curl commands.
The binaries can be replaced with compatible FFmpeg/FFprobe builds in this directory. No technical restriction prevents modification or reverse engineering of these components.
FFmpeg: https://ffmpeg.org/ — x264: https://www.videolan.org/developers/x264.html
There is no warranty; see the accompanying licence texts.
NOTICE
cd "$OUT_DIR"
sha256sum ffmpeg.exe ffprobe.exe Corresponding-Source.tar.gz > SHA256SUMS.txt
