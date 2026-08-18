//go:build windows

package media

import (
	"context"
	"fmt"
	"runtime"
	"syscall"
	"unsafe"
)

// The Microsoft HEIF Image Extension registers an ordinary WIC decoder.  We
// deliberately use WIC instead of asking FFmpeg to read HEIC: FFmpeg's normal
// Windows builds do not implement the HEIF still-image container.
const (
	wicCLSCTXInprocServer          = 0x1
	wicGenericRead                 = 0x80000000
	wicGenericWrite                = 0x40000000
	wicBitmapEncoderNoCache        = 0x2
	wicSOK                         = 0x00000000
	wicSFalse                      = 0x00000001
	wicRPCChangedMode       uint32 = 0x80010106
)

type wicGUID struct {
	Data1 uint32
	Data2 uint16
	Data3 uint16
	Data4 [8]byte
}

var (
	wicOle32        = syscall.NewLazyDLL("ole32.dll")
	wicProcCoInit   = wicOle32.NewProc("CoInitializeEx")
	wicProcCoUninit = wicOle32.NewProc("CoUninitialize")
	wicProcCoCreate = wicOle32.NewProc("CoCreateInstance")

	wicCLSIDImagingFactory = wicGUID{0xcacaf262, 0x9370, 0x4615, [8]byte{0xa1, 0x3b, 0x9f, 0x55, 0x39, 0xda, 0x4c, 0x0a}}
	wicIIDImagingFactory   = wicGUID{0xec5ec8a9, 0xc395, 0x4314, [8]byte{0x9c, 0x77, 0x54, 0xd7, 0xa9, 0x35, 0xff, 0x70}}
	wicContainerPNG        = wicGUID{0x1b7cfaf4, 0x713f, 0x473c, [8]byte{0xbb, 0xcd, 0x61, 0x37, 0x42, 0x5f, 0xae, 0xaf}}
	wicPixelFormatDontCare = wicGUID{0x6fddc324, 0x4e03, 0x4bfe, [8]byte{0xb1, 0x85, 0x3d, 0x77, 0x76, 0x8d, 0xc9, 0x00}}
)

func wicFailed(hr uintptr) bool { return int32(hr) < 0 }

func wicError(operation string, hr uintptr) error {
	return fmt.Errorf("Windows HEIF 图像扩展%s失败（HRESULT 0x%08X）", operation, uint32(hr))
}

func wicMethod(object uintptr, index uintptr) uintptr {
	vtable := *(*uintptr)(unsafe.Pointer(object))
	return *(*uintptr)(unsafe.Add(unsafe.Pointer(vtable), index*unsafe.Sizeof(uintptr(0))))
}

func wicCall(object uintptr, index uintptr, args ...uintptr) (uintptr, uintptr, error) {
	return syscall.SyscallN(wicMethod(object, index), append([]uintptr{object}, args...)...)
}

func wicRelease(object uintptr) {
	if object != 0 {
		_, _, _ = wicCall(object, 2)
	}
}

func withWIC(fn func(factory uintptr) error) error {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	hr, _, _ := wicProcCoInit.Call(0, 0) // COINIT_MULTITHREADED
	if wicFailed(hr) && uint32(hr) != wicRPCChangedMode {
		return wicError("初始化 COM", hr)
	}
	if hr == wicSOK || hr == wicSFalse {
		defer wicProcCoUninit.Call()
	}
	var factory uintptr
	hr, _, _ = wicProcCoCreate.Call(
		uintptr(unsafe.Pointer(&wicCLSIDImagingFactory)),
		0,
		wicCLSCTXInprocServer,
		uintptr(unsafe.Pointer(&wicIIDImagingFactory)),
		uintptr(unsafe.Pointer(&factory)),
	)
	if wicFailed(hr) || factory == 0 {
		return wicError("创建图像解码器", hr)
	}
	defer wicRelease(factory)
	return fn(factory)
}

func wicOpenPrimaryFrame(factory uintptr, input string) (frame uintptr, width, height uint32, err error) {
	path, err := syscall.UTF16PtrFromString(input)
	if err != nil {
		return 0, 0, 0, err
	}
	var decoder uintptr
	hr, _, _ := wicCall(factory, 3,
		uintptr(unsafe.Pointer(path)), 0, wicGenericRead, 0, uintptr(unsafe.Pointer(&decoder)))
	if wicFailed(hr) || decoder == 0 {
		return 0, 0, 0, wicError("打开 HEIC 文件", hr)
	}
	defer wicRelease(decoder)
	// IWICBitmapDecoder has QueryCapability and Initialize before the metadata
	// methods, so GetFrame is vtable slot 13 (not the similarly named frame
	// decoder interface's slot).
	hr, _, _ = wicCall(decoder, 13, 0, uintptr(unsafe.Pointer(&frame)))
	if wicFailed(hr) || frame == 0 {
		return 0, 0, 0, wicError("读取 HEIC 主图", hr)
	}
	hr, _, _ = wicCall(frame, 3, uintptr(unsafe.Pointer(&width)), uintptr(unsafe.Pointer(&height)))
	if wicFailed(hr) || width == 0 || height == 0 {
		wicRelease(frame)
		return 0, 0, 0, wicError("读取 HEIC 尺寸", hr)
	}
	return frame, width, height, nil
}

// ProbeModernImageWIC uses the installed Microsoft HEIF Image Extension to
// read an image's primary frame. It does not create any temporary files.
func ProbeModernImageWIC(ctx context.Context, input string) (ProbeInfo, error) {
	if err := ctx.Err(); err != nil {
		return ProbeInfo{}, err
	}
	var result ProbeInfo
	err := withWIC(func(factory uintptr) error {
		frame, width, height, openErr := wicOpenPrimaryFrame(factory, input)
		if openErr != nil {
			return openErr
		}
		defer wicRelease(frame)
		result.Width, result.Height = int(width), int(height)
		return nil
	})
	if err != nil {
		return ProbeInfo{}, err
	}
	return result, ctx.Err()
}

// DecodeModernImageToPNG decodes the HEIC/HEIF primary image through Windows
// WIC and writes a lossless PNG for the existing FFmpeg image pipeline.
func DecodeModernImageToPNG(ctx context.Context, input, output string) (ProbeInfo, error) {
	if err := ctx.Err(); err != nil {
		return ProbeInfo{}, err
	}
	var result ProbeInfo
	err := withWIC(func(factory uintptr) error {
		frame, width, height, openErr := wicOpenPrimaryFrame(factory, input)
		if openErr != nil {
			return openErr
		}
		defer wicRelease(frame)

		var stream uintptr
		hr, _, _ := wicCall(factory, 14, uintptr(unsafe.Pointer(&stream)))
		if wicFailed(hr) || stream == 0 {
			return wicError("创建 PNG 输出流", hr)
		}
		defer wicRelease(stream)
		outputPath, pathErr := syscall.UTF16PtrFromString(output)
		if pathErr != nil {
			return pathErr
		}
		hr, _, _ = wicCall(stream, 15, uintptr(unsafe.Pointer(outputPath)), wicGenericWrite)
		if wicFailed(hr) {
			return wicError("创建临时 PNG", hr)
		}

		var encoder uintptr
		hr, _, _ = wicCall(factory, 8, uintptr(unsafe.Pointer(&wicContainerPNG)), 0, uintptr(unsafe.Pointer(&encoder)))
		if wicFailed(hr) || encoder == 0 {
			return wicError("创建 PNG 编码器", hr)
		}
		defer wicRelease(encoder)
		hr, _, _ = wicCall(encoder, 3, stream, wicBitmapEncoderNoCache)
		if wicFailed(hr) {
			return wicError("初始化 PNG 编码器", hr)
		}

		var encodedFrame, options uintptr
		hr, _, _ = wicCall(encoder, 10, uintptr(unsafe.Pointer(&encodedFrame)), uintptr(unsafe.Pointer(&options)))
		if options != 0 {
			defer wicRelease(options)
		}
		if wicFailed(hr) || encodedFrame == 0 {
			return wicError("创建 PNG 帧", hr)
		}
		defer wicRelease(encodedFrame)
		hr, _, _ = wicCall(encodedFrame, 3, 0)
		if wicFailed(hr) {
			return wicError("初始化 PNG 帧", hr)
		}
		hr, _, _ = wicCall(encodedFrame, 4, uintptr(width), uintptr(height))
		if wicFailed(hr) {
			return wicError("设置 PNG 尺寸", hr)
		}
		pixelFormat := wicPixelFormatDontCare
		hr, _, _ = wicCall(encodedFrame, 6, uintptr(unsafe.Pointer(&pixelFormat)))
		if wicFailed(hr) {
			return wicError("设置 PNG 像素格式", hr)
		}
		hr, _, _ = wicCall(encodedFrame, 11, frame, 0)
		if wicFailed(hr) {
			return wicError("写入 PNG 像素", hr)
		}
		hr, _, _ = wicCall(encodedFrame, 12)
		if wicFailed(hr) {
			return wicError("提交 PNG 帧", hr)
		}
		hr, _, _ = wicCall(encoder, 11)
		if wicFailed(hr) {
			return wicError("完成临时 PNG", hr)
		}
		result.Width, result.Height = int(width), int(height)
		return nil
	})
	if err != nil {
		return ProbeInfo{}, err
	}
	return result, ctx.Err()
}
