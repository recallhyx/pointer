//! Minimal Accessibility (AXUIElement) bindings. Attribute names are passed as strings instead
//! of the `kAX…` constants, which are just CFSTR macros in the SDK headers.

use std::ffi::c_void;
use std::ptr;

use super::super::ax_diagnostics::AxCall;
use core_foundation::base::{CFRelease, CFRetain, CFType, CFTypeID, CFTypeRef, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::CFDictionary;
use core_foundation::number::CFNumber;
use core_foundation::string::{CFString, CFStringRef};
use core_foundation::url::CFURL;

/// Converts a CFString to UTF-8, replacing unpaired surrogates with U+FFFD.
///
/// `CFString::to_string` panics on them, and a range-limited read (context window,
/// `AXStringForRange`) can split an emoji's surrogate pair, so all AX text goes through here.
pub fn cf_string_lossy(s: &CFString) -> String {
    let len = s.char_len();
    if len <= 0 {
        return String::new();
    }
    let mut units = vec![0u16; len as usize];
    unsafe {
        CFStringGetCharacters(
            s.as_concrete_TypeRef(),
            core_foundation::base::CFRange {
                location: 0,
                length: len,
            },
            units.as_mut_ptr(),
        );
    }
    String::from_utf16_lossy(&units)
}

extern "C" {
    fn CFStringGetCharacters(s: CFStringRef, range: core_foundation::base::CFRange, buffer: *mut u16);
}

type AXUIElementRef = *const c_void;
type AXValueRef = *const c_void;
type AXError = i32;

const AX_VALUE_CGRECT: u32 = 3;
const AX_VALUE_CFRANGE: u32 = 4;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct CGPoint {
    pub x: f64,
    pub y: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct CGSize {
    pub width: f64,
    pub height: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct CGRect {
    pub origin: CGPoint,
    pub size: CGSize,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct CFRange {
    pub location: isize,
    pub length: isize,
}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXUIElementCreateSystemWide() -> AXUIElementRef;
    fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
    fn AXUIElementGetTypeID() -> CFTypeID;
    fn AXUIElementCopyAttributeValue(element: AXUIElementRef, attribute: CFStringRef, value: *mut CFTypeRef)
        -> AXError;
    fn AXUIElementCopyParameterizedAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        parameter: CFTypeRef,
        value: *mut CFTypeRef,
    ) -> AXError;
    fn AXUIElementSetAttributeValue(element: AXUIElementRef, attribute: CFStringRef, value: CFTypeRef) -> AXError;
    fn AXUIElementSetMessagingTimeout(element: AXUIElementRef, timeout_seconds: f32) -> AXError;
    fn AXUIElementGetPid(element: AXUIElementRef, pid: *mut i32) -> AXError;
    fn AXValueCreate(the_type: u32, value_ptr: *const c_void) -> AXValueRef;
    fn AXValueGetValue(value: AXValueRef, the_type: u32, value_ptr: *mut c_void) -> u8;
    fn AXIsProcessTrustedWithOptions(options: CFTypeRef) -> u8;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFArrayGetCount(array: CFTypeRef) -> isize;
    fn CFArrayGetValueAtIndex(array: CFTypeRef, idx: isize) -> CFTypeRef;
    fn CFArrayGetTypeID() -> CFTypeID;
}

pub fn is_trusted(prompt: bool) -> bool {
    let options = CFDictionary::from_CFType_pairs(&[(
        CFString::new("AXTrustedCheckOptionPrompt").as_CFType(),
        CFBoolean::from(prompt).as_CFType(),
    )]);
    unsafe { AXIsProcessTrustedWithOptions(options.as_CFTypeRef()) != 0 }
}

/// An owned AXUIElementRef.
pub struct Element(AXUIElementRef);

// AXUIElement is a CFType and can be used from any thread.
unsafe impl Send for Element {}

impl Drop for Element {
    fn drop(&mut self) {
        unsafe { CFRelease(self.0) }
    }
}

impl Clone for Element {
    fn clone(&self) -> Self {
        unsafe { CFRetain(self.0) };
        Element(self.0)
    }
}

impl Element {
    pub fn system_wide() -> Self {
        Element(unsafe { AXUIElementCreateSystemWide() })
    }

    pub fn application(pid: i32) -> Self {
        Element(unsafe { AXUIElementCreateApplication(pid) })
    }

    /// Caps how long a single call may block when the target app is busy.
    pub fn set_timeout(&self, seconds: f32) {
        unsafe { AXUIElementSetMessagingTimeout(self.0, seconds) };
    }

    pub fn pid_result(&self) -> Result<i32, AxCall> {
        let mut pid = 0;
        let code = unsafe { AXUIElementGetPid(self.0, &mut pid) };
        if code == 0 {
            Ok(pid)
        } else {
            Err(AxCall::new("AXUIElementGetPid", "", code))
        }
    }

    fn copy(&self, attribute: &str) -> Option<CFType> {
        self.copy_result(attribute).ok()
    }

    fn copy_result(&self, attribute: &str) -> Result<CFType, AxCall> {
        let name = CFString::new(attribute);
        let mut value: CFTypeRef = ptr::null();
        let err = unsafe { AXUIElementCopyAttributeValue(self.0, name.as_concrete_TypeRef(), &mut value) };
        let call = AxCall::new("AXUIElementCopyAttributeValue", attribute, err);
        if err != 0 {
            Err(call)
        } else if value.is_null() {
            Err(call.with_value_issue("null-result"))
        } else {
            Ok(unsafe { CFType::wrap_under_create_rule(value) })
        }
    }

    fn copy_with(&self, attribute: &str, parameter: CFTypeRef) -> Option<CFType> {
        let name = CFString::new(attribute);
        let mut value: CFTypeRef = ptr::null();
        let err = unsafe {
            AXUIElementCopyParameterizedAttributeValue(self.0, name.as_concrete_TypeRef(), parameter, &mut value)
        };
        (err == 0 && !value.is_null()).then(|| unsafe { CFType::wrap_under_create_rule(value) })
    }

    fn from_cf(value: &CFType) -> Option<Element> {
        if value.type_of() != unsafe { AXUIElementGetTypeID() } {
            return None;
        }
        unsafe { CFRetain(value.as_CFTypeRef()) };
        Some(Element(value.as_CFTypeRef()))
    }

    pub fn element(&self, attribute: &str) -> Option<Element> {
        self.element_result(attribute).ok()
    }

    pub fn element_result(&self, attribute: &str) -> Result<Element, AxCall> {
        Self::from_cf(&self.copy_result(attribute)?).ok_or_else(|| {
            AxCall::new("AXUIElementCopyAttributeValue", attribute, 0).with_value_issue("unexpected-type")
        })
    }

    pub fn children(&self) -> Vec<Element> {
        let Some(array) = self.copy("AXChildren") else {
            return Vec::new();
        };
        if array.type_of() != unsafe { CFArrayGetTypeID() } {
            return Vec::new();
        }
        let raw = array.as_CFTypeRef();
        let count = unsafe { CFArrayGetCount(raw) };
        (0..count)
            .filter_map(|i| {
                let item = unsafe { CFType::wrap_under_get_rule(CFArrayGetValueAtIndex(raw, i)) };
                Self::from_cf(&item)
            })
            .collect()
    }

    pub fn string(&self, attribute: &str) -> Option<String> {
        self.string_result(attribute).ok()
    }

    pub fn string_result(&self, attribute: &str) -> Result<String, AxCall> {
        self.copy_result(attribute)?
            .downcast::<CFString>()
            .map(|s| cf_string_lossy(&s))
            .ok_or_else(|| {
                AxCall::new("AXUIElementCopyAttributeValue", attribute, 0).with_value_issue("unexpected-type")
            })
    }

    pub fn url(&self, attribute: &str) -> Option<String> {
        let value = self.copy(attribute)?;
        if let Some(url) = value.downcast::<CFURL>() {
            return Some(url.get_string().to_string());
        }
        value.downcast::<CFString>().map(|s| cf_string_lossy(&s))
    }

    pub fn number(&self, attribute: &str) -> Option<i64> {
        self.copy(attribute)?.downcast::<CFNumber>()?.to_i64()
    }

    pub fn set_bool_result(&self, attribute: &str, value: bool) -> Result<(), AxCall> {
        let name = CFString::new(attribute);
        let value = CFBoolean::from(value);
        let code = unsafe { AXUIElementSetAttributeValue(self.0, name.as_concrete_TypeRef(), value.as_CFTypeRef()) };
        if code == 0 {
            Ok(())
        } else {
            Err(AxCall::new("AXUIElementSetAttributeValue", attribute, code))
        }
    }

    pub fn range(&self, attribute: &str) -> Option<CFRange> {
        let value = self.copy(attribute)?;
        let mut range = CFRange::default();
        let ok = unsafe {
            AXValueGetValue(
                value.as_CFTypeRef(),
                AX_VALUE_CFRANGE,
                &mut range as *mut _ as *mut c_void,
            )
        };
        (ok != 0).then_some(range)
    }

    fn range_param(range: CFRange) -> CFType {
        unsafe { CFType::wrap_under_create_rule(AXValueCreate(AX_VALUE_CFRANGE, &range as *const _ as *const c_void)) }
    }

    pub fn string_for_range(&self, range: CFRange) -> Option<String> {
        if range.length <= 0 {
            return None;
        }
        let param = Self::range_param(range);
        self.copy_with("AXStringForRange", param.as_CFTypeRef())?
            .downcast::<CFString>()
            .map(|s| cf_string_lossy(&s))
    }

    /// The selected text through WebKit text markers, which Chromium answers for the page's
    /// selection even where the focused node has no `AXSelectedText` of its own.
    pub fn selected_text_marker_string(&self) -> Option<String> {
        let range = self.copy("AXSelectedTextMarkerRange")?;
        self.copy_with("AXStringForTextMarkerRange", range.as_CFTypeRef())?
            .downcast::<CFString>()
            .map(|s| cf_string_lossy(&s))
    }

    pub fn bounds_for_range(&self, range: CFRange) -> Option<CGRect> {
        let param = Self::range_param(range);
        let value = self.copy_with("AXBoundsForRange", param.as_CFTypeRef())?;
        let mut rect = CGRect::default();
        let ok = unsafe {
            AXValueGetValue(
                value.as_CFTypeRef(),
                AX_VALUE_CGRECT,
                &mut rect as *mut _ as *mut c_void,
            )
        };
        (ok != 0 && rect.size.width > 0.0 && rect.size.height > 0.0).then_some(rect)
    }
}
