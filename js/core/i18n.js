// Localisation.
//
// The English string doubles as the lookup key, so call sites stay readable and
// any missing translation degrades to English instead of showing a raw key.
// Switching locale emits `locale`; UI modules re-render themselves on it.
import { bus } from './bus.js';

const STORE_KEY = 'kie.locale';

export const LOCALES = {
  en: { id: 'en', label: 'EN', name: 'English' },
  zh: { id: 'zh', label: '中', name: '简体中文' },
};

/* eslint-disable quote-props */
const zh = {
  /* ---- app shell ---- */
  'untitled': '未命名',
  'Navigator': '导航器',
  'Color': '颜色',
  'Layers': '图层',
  'History': '历史记录',
  'Palette': '色板',
  'Recent': '最近使用',
  'Opacity': '不透明度',
  'Undo': '撤销',
  'Redo': '重做',
  'Fit on screen': '适应屏幕',
  'Zoom in': '放大',
  'Zoom out': '缩小',
  'Click for 100%': '点击恢复 100%',
  'Help & shortcuts (?)': '帮助与快捷键 (?)',
  'Export': '导出',
  'Language': '语言',
  'Switch to English': '切换到英文',
  'Switch to Chinese': '切换到中文',
  'no selection': '无选区',
  'sel': '选区',
  'Document opened': '打开文档',

  /* ---- tools ---- */
  'Move': '移动',
  'Rectangular Select': '矩形选框',
  'Elliptical Select': '椭圆选框',
  'Lasso': '套索',
  'Magic Wand': '魔棒',
  'Crop': '裁剪',
  'Pencil': '铅笔',
  'Brush': '画笔',
  'Eraser': '橡皮擦',
  'Paint Bucket': '油漆桶',
  'Gradient': '渐变',
  'Line': '直线',
  'Rectangle': '矩形',
  'Ellipse': '椭圆',
  'Eyedropper': '吸管',
  'Hand': '抓手',
  'Zoom': '缩放',

  /* ---- tool options ---- */
  'Size': '大小',
  'Tip': '笔尖',
  'Square': '方形',
  'Circle': '圆形',
  'Hardness': '硬度',
  'Pixel perfect': '像素完美',
  'Fill': '填充',
  'Mode': '模式',
  'New': '新建',
  'Add': '添加',
  'Subtract': '减去',
  'Intersect': '交叉',
  'Anti-alias': '消除锯齿',
  'Tolerance': '容差',
  'Contiguous': '连续',
  'Sample all layers': '对所有图层取样',
  'Type': '类型',
  'Linear': '线性',
  'Radial': '径向',
  'Dither': '抖动',
  'Snap to pixel': '对齐像素',
  'Pixel grid': '像素网格',

  /* ---- status hints ---- */
  'Drag to draw · Shift: straight · Alt: pick color · Right-drag: secondary color':
    '拖动绘制 · Shift：直线 · Alt：拾色 · 右键拖动：背景色',
  'Soft-edged brush · Shift: straight': '柔边画笔 · Shift：直线',
  'Drag to erase to transparency': '拖动擦除为透明',
  'Drag for a line · Shift: 45° steps': '拖动绘制直线 · Shift：45° 步进',
  'Drag a rectangle · Shift: square': '拖动绘制矩形 · Shift：正方形',
  'Drag an ellipse · Shift: circle': '拖动绘制椭圆 · Shift：正圆',
  'Click to flood fill · Right-click: secondary color': '点击填充 · 右键：背景色',
  'Drag from start to end color': '从起点拖到终点生成渐变',
  'Click to sample color · Right-click sets secondary': '点击拾取颜色 · 右键设为背景色',
  'Drag a rectangular selection · Shift: square · Click to deselect':
    '拖动创建矩形选区 · Shift：正方形 · 点击取消选择',
  'Drag an elliptical selection · Shift: circle': '拖动创建椭圆选区 · Shift：正圆',
  'Drag a freehand selection': '拖动创建自由选区',
  'Click to select similar pixels': '点击选择相似像素',
  'Drag a crop box · Enter to apply · Esc to cancel': '拖动裁剪框 · Enter 应用 · Esc 取消',
  'Drag to pan · Space+drag works with any tool': '拖动平移 · 任意工具下按住空格拖动同样可用',
  'Click to zoom in · Alt-click to zoom out': '点击放大 · Alt+点击缩小',
  'Drag to move layer or selection contents · Arrows nudge':
    '拖动移动图层或选区内容 · 方向键微调',
  'Drag handles to scale · drag outside a corner to rotate · Enter to apply · Esc to cancel':
    '拖动控制点缩放 · 在角点外拖动旋转 · Enter 应用 · Esc 取消',

  /* ---- menus ---- */
  'File': '文件',
  'Edit': '编辑',
  'Image': '图像',
  'Layer': '图层',
  'Select': '选择',
  'Filter': '滤镜',
  'View': '视图',
  'Create, open, save and export documents.': '新建、打开、保存与导出文档。',
  'Undo, clipboard, fills and free transform.': '撤销、剪贴板、填充与自由变换。',
  'Resize, crop, flip and rotate the whole document.': '调整大小、裁剪、翻转与旋转整个文档。',
  'Add, arrange, merge and transform layers.': '添加、排列、合并与变换图层。',
  'Change which pixels editing affects.': '更改编辑所影响的像素范围。',
  'Adjust colour and apply effects to the current layer.': '调整颜色并对当前图层应用效果。',
  'Zoom, pixel grid and the help page.': '缩放、像素网格与帮助页面。',

  /* ---- hover help ---- */
  'Step backwards through your edit history.': '在编辑历史中后退一步。',
  'Reapply the edit you just undid.': '重新应用刚刚撤销的编辑。',
  'Show more of the canvas.': '显示更多画布内容。',
  'Magnify the canvas for pixel-level work.': '放大画布以进行像素级编辑。',
  'Zoom level': '缩放比例',
  'Click to return to 100%, actual pixel size.': '点击恢复 100%，即实际像素大小。',
  'Scale the view so the whole image is visible.': '缩放视图以显示完整图像。',
  'Switch the interface between English and Chinese.': '在中文与英文界面之间切换。',
  'Open the guide to every tool and keyboard shortcut.': '打开工具与快捷键指南。',
  'Choose a format, scale and quality, then save the image.': '选择格式、缩放与质量，然后保存图像。',
  'Overview of the whole image. Click or drag to jump around; click here to collapse.':
    '整幅图像的概览。点击或拖动可快速跳转；点此折叠。',
  'Add an empty layer above the current one.': '在当前图层上方添加空白图层。',
  'Copy the current layer, pixels and all.': '连同像素一起复制当前图层。',
  'Combine this layer into the one below it.': '将该图层合并到下方图层。',
  'Move this layer one step up the stack.': '将该图层上移一层。',
  'Move this layer one step down the stack.': '将该图层下移一层。',
  'Remove this layer from the document.': '从文档中删除该图层。',
  'Primary color': '前景色',
  'Used by left-click. Press X to swap with the secondary color.': '左键使用。按 X 与背景色交换。',
  'Used by right-click. Click to swap it with the primary color.': '右键使用。点击可与前景色交换。',
  'Swap colors': '交换颜色',
  'Output file format. PNG keeps transparency; JPEG does not.':
    '输出文件格式。PNG 保留透明度，JPEG 不支持。',
  'Multiply the exported size — ideal for sharing pixel art.':
    '按倍数放大导出尺寸 — 适合分享像素画。',

  /* ---- commands: file ---- */
  'New…': '新建…',
  'New Image': '新建图像',
  'Pick a preset or enter a custom size.': '选择预设或输入自定义尺寸。',
  'Open Image…': '打开图像…',
  'Import as Layer…': '导入为图层…',
  'Save': '保存',
  'Save…': '保存…',
  'Export / Save As…': '导出 / 另存为…',
  'Quick Export PNG': '快速导出 PNG',
  'Save Project (.glassx)': '保存工程 (.glassx)',
  'Open Project…': '打开工程…',
  'Background': '背景',
  'Transparent': '透明',
  'White': '白色',
  'Black': '黑色',
  'Primary color': '前景色',
  'Width': '宽度',
  'Height': '高度',
  'Create': '创建',

  /* ---- commands: edit ---- */
  'Cut': '剪切',
  'Copy': '复制',
  'Paste': '粘贴',
  'Clear': '清除',
  'Fill with Primary': '用前景色填充',
  'Fill with Secondary': '用背景色填充',
  'Free Transform': '自由变换',

  /* ---- commands: image ---- */
  'Image Size…': '图像大小…',
  'Image Size': '图像大小',
  'Currently {size} px.': '当前尺寸为 {size} 像素。',
  'Canvas Size…': '画布大小…',
  'Canvas Size': '画布大小',
  'Grows or crops the canvas without scaling pixels.': '扩展或裁剪画布，不缩放像素。',
  'Trim Transparent Edges': '裁去透明边缘',
  'Flip Horizontal': '水平翻转',
  'Flip Vertical': '垂直翻转',
  'Rotate 90° CW': '顺时针旋转 90°',
  'Rotate 90° CCW': '逆时针旋转 90°',
  'Rotate 180°': '旋转 180°',
  'Flatten Image': '拼合图像',
  'Smooth (off = pixel art)': '平滑（关闭 = 像素画）',
  'Resize': '调整大小',
  'Anchor': '定位',
  'Top left': '左上',
  'Top': '上',
  'Top right': '右上',
  'Left': '左',
  'Center': '居中',
  'Right': '右',
  'Bottom left': '左下',
  'Bottom': '下',
  'Bottom right': '右下',

  /* ---- commands: layer ---- */
  'New Layer': '新建图层',
  'Duplicate Layer': '复制图层',
  'Delete Layer': '删除图层',
  'Raise Layer': '上移图层',
  'Lower Layer': '下移图层',
  'Merge Down': '向下合并',
  'Flip Layer Horizontal': '水平翻转图层',
  'Flip Layer Vertical': '垂直翻转图层',
  'Rotate Layer 90° CW': '图层顺时针旋转 90°',
  'Rotate Layer 90° CCW': '图层逆时针旋转 90°',

  /* ---- commands: select ---- */
  'Select All': '全选',
  'Deselect': '取消选择',
  'Invert Selection': '反选',
  'Selection from Layer Alpha': '从图层透明度建立选区',

  /* ---- commands: view ---- */
  'Zoom In': '放大',
  'Zoom Out': '缩小',
  'Actual Size': '实际大小',
  'Fit on Screen': '适应屏幕',
  'Show Pixel Grid': '显示像素网格',
  'Hide Pixel Grid': '隐藏像素网格',
  'Toggle Pixel Grid': '切换像素网格',
  'Help & Keyboard Shortcuts': '帮助与快捷键',

  /* ---- filters ---- */
  'Brightness / Contrast': '亮度 / 对比度',
  'Brightness': '亮度',
  'Contrast': '对比度',
  'Hue / Saturation': '色相 / 饱和度',
  'Hue': '色相',
  'Saturation': '饱和度',
  'Value': '明度',
  'Grayscale': '黑白',
  'Invert': '反相',
  'Sepia': '棕褐色',
  'Posterize': '色调分离',
  'Levels': '级数',
  'Threshold': '阈值',
  'Level': '阈值',
  'Ordered Dither': '有序抖动',
  'Gaussian Blur': '高斯模糊',
  'Radius': '半径',
  'Sharpen': '锐化',
  'Amount': '数量',
  'Find Edges': '查找边缘',
  'Noise': '噪点',
  'Pixelate': '马赛克',
  'Block size': '块大小',
  'Pixel Outline': '像素描边',
  'Thickness': '粗细',

  /* ---- blend modes ---- */
  'Normal': '正常',
  'Multiply': '正片叠底',
  'Screen': '滤色',
  'Overlay': '叠加',
  'Darken': '变暗',
  'Lighten': '变亮',
  'Dodge': '颜色减淡',
  'Burn': '颜色加深',
  'Hard Light': '强光',
  'Soft Light': '柔光',
  'Difference': '差值',
  'Exclusion': '排除',
  'Luminosity': '明度',

  /* ---- layers panel ---- */
  'New layer': '新建图层',
  'Duplicate': '复制',
  'Merge down': '向下合并',
  'Raise': '上移',
  'Lower': '下移',
  'Delete': '删除',
  'Blend mode': '混合模式',
  'Layer opacity': '图层不透明度',
  'Hide layer': '隐藏图层',
  'Show layer': '显示图层',
  'Imported': '已导入',
  'Flattened': '已拼合',

  /* ---- color panel ---- */
  'Secondary color': '背景色',
  'Hex color': '十六进制颜色',

  /* ---- dialogs ---- */
  'OK': '确定',
  'Cancel': '取消',
  'Done': '完成',
  'Apply': '应用',
  'Confirm': '确认',
  'Discard': '放弃',
  'Discard unsaved changes?': '放弃未保存的更改？',
  'This will replace the current image and cannot be undone.': '这将替换当前图像，且无法撤销。',

  /* ---- export dialog ---- */
  'Export Image': '导出图像',
  'Save As…': '另存为…',
  'Export preview': '导出预览',
  'Could not export image': '无法导出图像',
  'Source document is {size} px.': '源文档尺寸为 {size} 像素。',
  'Saved': '已保存',
  'Exported': '已导出',
  'Dimensions': '尺寸',
  'Estimated size': '预计大小',
  'File name': '文件名',
  'Format': '格式',
  'Scale': '缩放',
  'Quality': '质量',
  'PNG is lossless and keeps transparency.': 'PNG 为无损格式，并保留透明度。',
  'WebP is lossy at this quality but keeps transparency.': '当前质量下 WebP 为有损格式，但保留透明度。',
  'JPEG has no transparency — transparent areas become white.': 'JPEG 不支持透明 — 透明区域将变为白色。',

  /* ---- help ---- */
  'kie — a pixel-art image editor that runs entirely in your browser.':
    'kie — 完全运行在浏览器中的像素画编辑器。',
  'Tools': '工具',
  'Canvas': '画布',
  'Painting': '绘制',
  'Transform & crop': '变换与裁剪',
  'Press a letter to pick a tool. ': '按字母键选择工具。',
  'When several tools share a letter, press it again — or use ':
    '当多个工具共用同一字母时，再次按下该键 — 或使用 ',
  ' + the letter — to cycle through them.': ' + 该字母 — 即可循环切换。',
  'or': '或',
  'Pan the canvas': '平移画布',
  'Middle-drag': '中键拖动',
  'Wheel / trackpad': '滚轮 / 触控板',
  'Scroll the canvas': '滚动画布',
  'Scroll horizontally': '水平滚动',
  'Zoom at the cursor': '以光标为中心缩放',
  'Drag': '拖动',
  'Paint with the primary color': '使用前景色绘制',
  'Right-drag': '右键拖动',
  'Paint with the secondary color': '使用背景色绘制',
  'Constrain to straight lines': '约束为直线',
  'Temporary eyedropper': '临时吸管',
  'Decrease / increase brush size': '减小 / 增大笔刷',
  'Swap primary and secondary color': '交换前景色与背景色',
  'Reset to black and white': '恢复为黑白',
  'Drag handles': '拖动控制点',
  'Scale the selection': '缩放选区',
  'Drag outside a corner': '在角点外拖动',
  'Rotate': '旋转',
  'Keep aspect ratio': '保持长宽比',
  'Arrow keys': '方向键',
  'Nudge by 1px (⇧ for 10px)': '微调 1 像素（⇧ 为 10 像素）',
  'Enter': 'Enter',
  'Esc': 'Esc',
  'Save to the opened file': '保存到已打开的文件',

  /* ---- toasts & messages ---- */
  'Copied': '已复制',
  'Pasted as new layer': '已粘贴为新图层',
  'Pasted image as layer': '已将图像粘贴为图层',
  'Could not import image': '无法导入图像',
  'Could not open image': '无法打开图像',
  'Clipboard is empty': '剪贴板为空',
  'Layer is locked': '图层已锁定',
  'Layer is hidden': '图层已隐藏',
  'Cannot delete the last layer': '无法删除最后一个图层',
  'No layer below': '下方没有图层',
  'Nothing to trim': '没有可裁去的区域',
  'Already trimmed': '已无多余边缘',
  'Project saved': '工程已保存',
  'Could not open project': '无法打开工程',
  'Could not save — use Export instead': '无法保存 — 请改用导出',
  'Exported PNG': '已导出 PNG',
  'Drag handles · Enter to apply · Esc to cancel': '拖动控制点 · Enter 应用 · Esc 取消',

  /* ---- history entry labels ---- */
  'Paint': '绘制',
  'Transform': '变换',
  'Transform Layer': '变换图层',
  'Select': '选择',
  'Lasso Select': '套索选择',
  'Reorder Layer': '重排图层',
  'Import Layer': '导入图层',
  'Layer Property': '图层属性',
  'Toggle Visibility': '切换可见性',
  'Blend Mode': '混合模式',
  'Layer Opacity': '图层不透明度',
  'Rename Layer': '重命名图层',
  'Trim': '裁去边缘',
  'Selection from Layer': '从图层建立选区',
  'Rotate 90°': '顺时针旋转 90°',
  'Rotate 270°': '逆时针旋转 90°',

  /* ---- document & layer op failures ---- */
  'Could not update document': '无法更新文档',
  'Could not transform layer': '无法变换图层',
  'Could not clear selection': '无法清除选区',
  'Could not fill selection': '无法填充选区',
  'Invalid or oversized document dimensions': '文档尺寸无效或过大',
  'Invalid document dimensions': '文档尺寸无效',
  'Cannot merge backdrop-dependent blend modes': '无法合并依赖背景图层的混合模式',

  /* ---- project save errors ---- */
  'Project cannot be saved': '无法保存工程',
  'the document must contain at least one layer': '文档必须至少包含一个图层',
  'select an active layer and try again': '请选择活动图层后重试',
  'a layer has invalid properties': '某个图层的属性无效',
  'a layer has invalid dimensions': '某个图层的尺寸无效',
  'the encoded project is too large; merge layers or reduce the canvas size':
    '编码后的工程过大，请合并图层或减小画布尺寸',
  'a layer could not be encoded; merge layers or reduce the canvas size':
    '某个图层无法编码，请合并图层或减小画布尺寸',
  'dimensions must be between 1 and {n}px': '尺寸必须在 1 到 {n} 像素之间',
  'the {n}-layer limit is exceeded; merge or delete layers': '已超出 {n} 个图层上限，请合并或删除图层',
  'this canvas size supports at most {n} project layers; merge or delete layers':
    '当前画布尺寸最多支持 {n} 个工程图层，请合并或删除图层',
  'this canvas size supports at most 1 project layer; merge or delete layers':
    '当前画布尺寸最多支持 1 个工程图层，请合并或删除图层',
  'layer names must be at most {n} characters': '图层名称不能超过 {n} 个字符',

  /* ---- file pickers ---- */
  'Images': '图像',
  'PNG image': 'PNG 图像',
  'JPEG image': 'JPEG 图像',
  'WebP image': 'WebP 图像',
};
/* eslint-enable quote-props */

const TABLES = { en: null, zh };

let current = 'en';

/** Translate `s` into the active locale, falling back to the source string. */
export function t(s) {
  if (s == null) return s;
  const table = TABLES[current];
  return (table && table[s]) || s;
}

export const locale = () => current;

function applyToDocument(id) {
  document.documentElement.lang = id === 'zh' ? 'zh-CN' : 'en';
  document.documentElement.dataset.locale = id;
}

export function setLocale(id) {
  if (!LOCALES[id] || id === current) return;
  current = id;
  try { localStorage.setItem(STORE_KEY, id); } catch { /* private mode */ }
  applyToDocument(id);
  bus.emit('locale', id);
}

/** Restore the saved locale, else follow the browser language. */
export function initLocale() {
  let saved = null;
  try { saved = localStorage.getItem(STORE_KEY); } catch { /* private mode */ }
  if (LOCALES[saved]) current = saved;
  else current = (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
  applyToDocument(current);
  return current;
}
