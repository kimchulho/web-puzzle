/**
 * 서비스 이용약관 (초안)
 * 법적 효력 검토는 반드시 변호사·세무 전문가에게 맡기시기 바랍니다.
 */
import React from 'react';
import { ChevronLeft } from 'lucide-react';

const EFFECTIVE_DATE = '2026년 3월 31일';

export default function TermsOfService({
  onBack,
  /** WebView 등: 상태바 높이만큼 sticky 기준선을 내림 */
  safeAreaTop = 0,
}: {
  onBack: () => void;
  safeAreaTop?: number;
}) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <header
        className="sticky z-10 border-b border-slate-800 bg-slate-950/90 backdrop-blur-sm px-4 py-3 flex items-center gap-3"
        style={{ top: safeAreaTop }}
      >
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-slate-400 hover:text-white text-sm transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
          돌아가기
        </button>
        <h1 className="text-sm font-semibold text-white truncate">웹퍼즐 서비스 이용약관</h1>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 pb-16 text-sm leading-relaxed space-y-8">
        <section>
          <p className="text-slate-400 text-xs mb-2">시행일: {EFFECTIVE_DATE}</p>
          <h2 className="text-lg font-bold text-white mb-3">제1조 (목적)</h2>
          <p>
            본 약관은 <strong>종이천하</strong>(이하 &quot;운영자&quot;)가 제공하는 온라인 직소 퍼즐 서비스
            <strong className="text-white"> 「웹퍼즐」</strong>(이하 &quot;서비스&quot;)의 이용과 관련하여 운영자와
            이용자 간 권리·의무 및 책임사항, 기타 필요한 사항을 규정함을 목적으로 합니다.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-white mb-3">제2조 (정의)</h2>
          <ol className="list-decimal list-inside space-y-2 text-slate-300">
            <li>&quot;서비스&quot;란 운영자가 제공하는 인터넷 웹사이트·모바일 애플리케이션 등 각 접속 경로를 통한 직소 퍼즐 및 부가 기능 일체를 말합니다.</li>
            <li>&quot;이용자&quot;란 본 약관에 동의하고 서비스를 이용하는 자를 말합니다.</li>
            <li>&quot;계정&quot;이란 서비스 이용을 위해 운영자가 부여한 이용 자격 및 이에 수반된 식별 수단을 말합니다.</li>
            <li>&quot;콘텐츠&quot;란 서비스 내 제공되는 이미지, 텍스트, 프로그램, UI 등 일체를 말합니다.</li>
          </ol>
        </section>

        <section>
          <h2 className="text-lg font-bold text-white mb-3">제3조 (약관의 게시와 개정)</h2>
          <ol className="list-decimal list-inside space-y-2 text-slate-300">
            <li>운영자는 본 약관을 서비스 내 연결화면(예: 이용약관 페이지)에 게시합니다.</li>
            <li>운영자는 관련 법령을 위배하지 않는 범위에서 약관을 개정할 수 있습니다.</li>
            <li>약관을 개정할 경우 적용일자 및 개정 사유를 명시하여 적용 7일 전부터 공지합니다. 다만 이용자에게 불리한 변경은 최소 30일 전 공지하거나 통지합니다(법령에 달리 정함이 있는 경우에는 그에 따름).</li>
            <li>이용자가 개정약관 시행일 이후에도 서비스를 계속 이용하는 경우 개정에 동의한 것으로 볼 수 있습니다.</li>
          </ol>
        </section>

        <section>
          <h2 className="text-lg font-bold text-white mb-3">제4조 (서비스의 제공)</h2>
          <ol className="list-decimal list-inside space-y-2 text-slate-300">
            <li>서비스는 연중무휴 1일 24시간 제공함을 원칙으로 하나, 시스템 점검·장애·기술적 필요 등으로 일시 중단될 수 있습니다.</li>
            <li>운영자는 서비스의 내용·구성·기능을 변경할 수 있으며, 중요한 변경 시 사전 또는 사후에 공지할 수 있습니다.</li>
            <li>서비스는 <strong>웹 브라우저</strong>, <strong>모바일 애플리케이션</strong> 등 이용 환경별로 제공될 수 있으며, 환경별 이용조건·제한은 해당 앱 마켓·플랫폼 정책 및 본 약관을 따릅니다.</li>
          </ol>
        </section>

        <section>
          <h2 className="text-lg font-bold text-white mb-3">제5조 (이용자격 및 연령)</h2>
          <ol className="list-decimal list-inside space-y-2 text-slate-300">
            <li>
              일부 이용 경로(모바일 앱 등)에는 <strong className="text-white">해당 플랫폼 정책 또는 운영자의 별도 고지</strong>에 따라
              연령·자격 제한이 적용될 수 있습니다. 이용자는 적용되는 요건을 충족함을 보증합니다. 운영자는 관련 법령 또는
              제휴·배포 플랫폼 정책 변경에 따라 이용 제한 조건을 조정할 수 있습니다.
            </li>
            <li>
              그 밖의 채널에 대한 연령 및 법정대리인 동의 요건은 관련 법령(「개인정보 보호법」, 「전자상거래법」 등)에 따르며,
              필요 시 운영자는 추가 확인을 요청할 수 있습니다.
            </li>
          </ol>
        </section>

        <section>
          <h2 className="text-lg font-bold text-white mb-3">제6조 (회원가입·로그인 및 계정)</h2>
          <ol className="list-decimal list-inside space-y-2 text-slate-300">
            <li>
              이용자는 운영자가 정한 절차에 따라 <strong className="text-white">사용자 아이디(user_name 형태의 계정 식별 정보)</strong> 등을
              등록하고 서비스를 이용할 수 있습니다. 구체적 수집 항목은 개인정보처리방침에 따릅니다.
            </li>
            <li>이용자는 제3자의 정보를 도용하거나 허위 정보를 제공해서는 안 됩니다.</li>
            <li>계정 정보 관리 책임은 이용자에게 있으며, 이용자의 과실로 발생한 손해에 대해 운영자는 책임을 지지 않습니다(법령상 달리 정함이 있는 경우 제외).</li>
            <li>운영자는 이용자가 약관·법령을 위반하거나 서비스 운영에 중대한 지장을 초래하는 경우 계정 이용을 제한·정지 또는 탈퇴 처리할 수 있습니다.</li>
          </ol>
        </section>

        <section>
          <h2 className="text-lg font-bold text-white mb-3">제7조 (개인정보의 보호)</h2>
          <p>
            운영자는 이용자의 개인정보를 중요시하며, 관련 법령 및 <strong className="text-white">개인정보처리방침</strong>에 따라
            처리합니다. 본 서비스에서 수집하는 정보에는 이용 목적에 필요한 범위에서의 <strong className="text-white">사용자명(user_name)</strong> 등이
            포함될 수 있습니다. 상세한 수집·이용·보관·파기 내용은 별도 게시하는 개인정보처리방침을 따릅니다.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-white mb-3">제8조 (유료 서비스 및 결제)</h2>
          <ol className="list-decimal list-inside space-y-2 text-slate-300">
            <li>
              운영자는 서비스 내 일부 기능·콘텐츠·아이템 등을 <strong className="text-white">유료</strong>로 제공할 수 있으며,
              가격·과금 방식·환불 조건 등은 서비스 내 고지 또는 결제 화면에 명시합니다.
            </li>
            <li>
              결제는 이동통신사·앱 마켓·전자결제(간편결제)·신용·체크카드 등 <strong className="text-white">제3자 결제대행사</strong>를 통해 이루어질 수 있으며,
              결제 관련 기술적 오류·승인 거절 등에 대해 운영자는 통상적으로 책임지지 않습니다(고의 또는 중과실이 있는 경우 등 법령상 달리 정함이 있는 경우 제외).
            </li>
            <li>
              <strong className="text-white">청약철회·환불</strong>은 「전자상거래 등에서의 소비자보호에 관한 법률」 등 관련 법령 및
              결제 수단별 정책에 따릅니다. 디지털 콘텐츠 특성상 철회가 제한될 수 있는 경우 법령이 허용하는 범위 내에서 별도 고지합니다.
            </li>
          </ol>
        </section>

        <section>
          <h2 className="text-lg font-bold text-white mb-3">제9조 (광고)</h2>
          <ol className="list-decimal list-inside space-y-2 text-slate-300">
            <li>운영자는 서비스 운영과 관련하여 서비스 화면 또는 제휴 채널에 <strong className="text-white">광고</strong>를 게재할 수 있습니다.</li>
            <li>이용자가 광고주가 제공하는 재화·용역을 이용할 때의 책임은 해당 거래 당사자 간에 있으며, 운영자는 이에 대해 보증·중재 의무를 부담하지 않습니다(법령상 달리 정함이 있는 경우 제외).</li>
          </ol>
        </section>

        <section>
          <h2 className="text-lg font-bold text-white mb-3">제10조 (이용자의 의무)</h2>
          <p className="mb-2">이용자는 다음 행위를 하여서는 안 됩니다.</p>
          <ul className="list-disc list-inside space-y-1 text-slate-300">
            <li>타인의 권리·명예를 침해하거나 불법 정보를 유포하는 행위</li>
            <li>서비스의 안정적 운영을 방해하는 행위(해킹, 크롤링 남용, 악성코드 유포 등)</li>
            <li>자동화 수단을 이용한 부정 이용, 매크로·치팅 등 공정성을 해치는 행위</li>
            <li>운영자·제3자의 지식재산권을 침해하는 행위</li>
            <li>기타 관련 법령 및 공서양속에 반하는 행위</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-bold text-white mb-3">제11조 (지식재산권)</h2>
          <p>
            서비스 및 이에 포함된 콘텐츠에 대한 저작권 등 지식재산권은 운영자 또는 정당한 권리자에게 귀속됩니다.
            이용자는 운영자의 사전 동의 없이 이를 복제·배포·2차적 저작물 작성 등의 방법으로 이용할 수 없습니다.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-white mb-3">제12조 (책임의 한계)</h2>
          <ol className="list-decimal list-inside space-y-2 text-slate-300">
            <li>운영자는 천재지변, 불가항력, 제3자 서비스 장애 등 운영자의 합리적 통제 범위를 벗어난 사유로 서비스를 제공할 수 없는 경우 책임이 면제될 수 있습니다.</li>
            <li>운영자는 이용자 간 또는 이용자와 제3자 간에 서비스를 매개로 발생한 분쟁에 개입할 의무가 없으며, 이로 인한 손해에 대해 책임지지 않습니다.</li>
            <li>법령상 허용되는 한도에서, 운영자의 고의 또는 중대한 과실이 없는 한 간접·특별·결과적 손해에 대해서는 책임을 지지 않습니다.</li>
          </ol>
        </section>

        <section>
          <h2 className="text-lg font-bold text-white mb-3">제13조 (분쟁 해결 및 준거법)</h2>
          <ol className="list-decimal list-inside space-y-2 text-slate-300">
            <li>본 약관은 대한민국 법령에 따릅니다.</li>
            <li>서비스 이용과 관련하여 운영자와 이용자 간 분쟁이 발생한 경우 상호 협의로 해결하도록 노력합니다.</li>
            <li>소송이 제기되는 경우 관할법원은 「민사소송법」 등 관련 법령에 따릅니다.</li>
          </ol>
        </section>

        <section>
          <h2 className="text-lg font-bold text-white mb-3">제14조 (운영자 정보 및 문의)</h2>
          <ul className="space-y-1 text-slate-300">
            <li><strong className="text-white">서비스명:</strong> 웹퍼즐</li>
            <li><strong className="text-white">상호:</strong> 종이천하(개인사업자)</li>
            <li><strong className="text-white">대표자:</strong> 김철호</li>
            <li><strong className="text-white">문의(이메일):</strong>{' '}
              <a href="mailto:seeker7263@gmail.com" className="text-indigo-400 hover:underline">seeker7263@gmail.com</a>
            </li>
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            사업자 등록번호·영업소 소재지 등 추가 표기가 필요한 경우 관련 법령 및 앱 스토어 정책에 맞춰 본 조항을 보완하시기 바랍니다.
          </p>
        </section>
      </main>
    </div>
  );
}
