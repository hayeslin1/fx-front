import { MAIN_CONTENT_ID } from './main-content-id';

/**
 * 跳到主要内容（设计文档 §11.2：键盘可用底线）。
 * WHY：两端壳的头部/侧栏导航位于 DOM 前部，键盘用户每次换页都要逐个 Tab 穿越；
 * 本链接是壳内首个可聚焦元素，直达 <main id={MAIN_CONTENT_ID}>，跳过全部导航。
 * 静默态样式见 src/index.css 的 .skip-link（fixed + 移出视口，不占位、不影响布局）；
 * 聚焦时以固定定位浮层出现在左上角（不挤压运营端首层 flex 行布局）。
 */
export function SkipLink() {
  return (
    <a className="skip-link" href={`#${MAIN_CONTENT_ID}`}>
      跳到主要内容
    </a>
  );
}
