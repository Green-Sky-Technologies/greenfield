// Home — Light as React + Tailwind CSS v4. Theme: variable.export {format: "tailwind"}.
export function HomeLight() {
  return (
    <div className="relative w-[393px] h-[852px] bg-bg">
      <div className="absolute left-0 top-0 w-full min-h-[48px] flex flex-row pt-[6px] pr-[30px] pl-[30px] justify-between items-center">
        <p className="text-text font-['Inter'] text-[15px] font-semibold leading-[1.4]">9:41</p>
        <div className="flex flex-row gap-[6px] items-center">
          <div className="flex flex-row gap-[2px] items-end">
            <div className="w-[3px] h-1 rounded-[1px] bg-text"></div>
            <div className="w-[3px] h-[6px] rounded-[1px] bg-text"></div>
            <div className="w-[3px] h-2 rounded-[1px] bg-text"></div>
            <div className="w-[3px] h-[10px] rounded-[1px] bg-text"></div>
          </div>
          <div className="w-[25px] h-3 rounded-[3.5px] border border-text relative">
            <div className="absolute left-[2px] top-[2px] w-[17px] h-2 rounded-[1.5px] bg-text"></div>
          </div>
        </div>
      </div>
      <div className="absolute left-0 top-12 w-full flex flex-col gap-5 pt-[10px] pr-5 pl-5 items-start">
        <div className="self-stretch w-full max-w-[353px] flex flex-row gap-3 justify-between items-center">
          <div className="flex flex-col gap-[2px] items-start">
            <p className="text-muted font-['Inter'] text-[13px] font-medium leading-[1.4]">Good morning, Maya</p>
            <p className="text-text font-['Inter'] text-[28px] font-bold leading-[1.2] tracking-[-0.02em]">Where to today?</p>
          </div>
          <div className="w-full max-w-[46px] min-h-[46px] flex flex-row justify-center items-center rounded-[23px] bg-[linear-gradient(135deg,_#FF9A62_0%,_#E2557A_100%)]">
            <p className="text-[#FFFFFF] font-['Inter'] text-[15px] font-semibold leading-[1.4]">MC</p>
          </div>
        </div>
        <div className="self-stretch w-full max-w-[353px] min-h-[50px] flex flex-row gap-[10px] px-4 justify-between items-center rounded-[14px] bg-field">
          <div className="flex flex-row gap-[10px] items-center">
            <div className="w-5 h-5 relative">
              <div className="absolute left-[3.33px] top-[3.33px] w-[13.75px] h-[13.75px] border-[2px] border-muted"></div>
            </div>
            <p className="text-muted font-['Inter'] text-[15px] font-normal leading-[1.5]">Search trails, peaks, lakes</p>
          </div>
          <div className="w-5 h-5 relative">
            <div className="absolute left-[3.33px] top-[3.75px] w-[13.33px] h-[12.5px] border-[2px] border-text"></div>
          </div>
        </div>
        <div className="flex flex-row gap-2 items-center">
          <div className="flex flex-row gap-[6px] py-2 px-4 items-center rounded-full bg-brand">
            <p className="text-onbrand font-['Inter'] text-[13px] font-medium leading-[1.4]">All trails</p>
          </div>
          <div className="flex flex-row gap-[6px] py-2 px-4 items-center rounded-full bg-surface border border-border">
            <p className="text-text font-['Inter'] text-[13px] font-medium leading-[1.4]">Hikes</p>
          </div>
          <div className="flex flex-row gap-[6px] py-2 px-4 items-center rounded-full bg-surface border border-border">
            <p className="text-text font-['Inter'] text-[13px] font-medium leading-[1.4]">Lakes</p>
          </div>
          <div className="flex flex-row gap-[6px] py-2 px-4 items-center rounded-full bg-surface border border-border">
            <p className="text-text font-['Inter'] text-[13px] font-medium leading-[1.4]">Summits</p>
          </div>
        </div>
        <div className="self-stretch w-full max-w-[353px] flex flex-row gap-2 justify-between items-center">
          <p className="text-text font-['Inter'] text-[17px] font-semibold leading-[1.3] tracking-[-0.01em]">Featured trail</p>
          <p className="text-brand font-['Inter'] text-[13px] font-medium leading-[1.4]">See all</p>
        </div>
        <div className="self-stretch w-full max-w-[353px] flex flex-col items-start rounded-[20px] bg-surface shadow-[0px_8px_24px_0px_rgba(15,_23,_42,_0.08),_0px_1px_3px_0px_rgba(15,_23,_42,_0.04)]">
          <div className="self-stretch w-full max-w-[353px] h-44 bg-[linear-gradient(180deg,_#8FCDF2_0%,_#E4F3FB_100%)] relative">
            <div className="absolute left-[232.98px] top-[31.68px] w-[45.11px] h-[40.48px] rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,_#FFF8E1_0%,_#FFD36B_100%)]"></div>
            <div className="absolute left-0 top-[52.8px] w-full max-w-[353px] h-[123.2px] bg-[linear-gradient(180deg,_#9CB7D8_0%,_#C9D9EC_100%)]"></div>
            <div className="absolute left-0 top-[84.48px] w-full max-w-[353px] h-[91.52px] bg-[linear-gradient(180deg,_#4F9E8F_0%,_#86C4B2_100%)]"></div>
            <div className="absolute left-[109.82px] top-[61.6px] w-[18.63px] h-[14.08px] bg-[rgba(255,_255,_255,_0.85)]"></div>
            <div className="absolute left-0 top-[136.78px] w-full max-w-[353px] h-[39.22px] bg-[linear-gradient(180deg,_#1E5E54_0%,_#2E7A6A_100%)]"></div>
          </div>
          <div className="self-stretch w-full max-w-[353px] flex flex-col gap-2 p-4 items-start">
            <div className="self-stretch w-full max-w-[321px] flex flex-row gap-2 justify-between items-center">
              <p className="text-text font-['Inter'] text-[17px] font-semibold leading-[1.3] tracking-[-0.01em]">Larch Valley Loop</p>
              <div className="flex flex-row gap-1 items-center">
                <div className="w-[14px] h-[14px] rounded-[1px] bg-accent"></div>
                <p className="text-text font-['Inter'] text-[13px] font-medium leading-[1.4]">4.9</p>
              </div>
            </div>
            <div className="flex flex-row gap-[14px] items-center">
              <div className="flex flex-row gap-1 items-center">
                <div className="w-4 h-4 relative">
                  <div className="absolute left-[3.33px] top-[1.87px] w-[9.33px] h-[12.13px] border-[2.2px] border-muted"></div>
                </div>
                <p className="text-muted font-['Inter'] text-[13px] font-medium leading-[1.4]">Banff, AB</p>
              </div>
              <div className="flex flex-row gap-1 items-center">
                <div className="w-4 h-4 relative">
                  <div className="absolute left-[2.67px] top-[2px] w-[10.67px] h-3 border-[2.2px] border-muted"></div>
                </div>
                <p className="text-muted font-['Inter'] text-[13px] font-medium leading-[1.4]">8.6 km</p>
              </div>
              <div className="flex flex-row gap-1 items-center">
                <div className="w-4 h-4 relative">
                  <div className="absolute left-[2px] top-[2px] w-3 h-3 border-[2.2px] border-muted"></div>
                </div>
                <p className="text-muted font-['Inter'] text-[13px] font-medium leading-[1.4]">3h 10m</p>
              </div>
            </div>
          </div>
        </div>
        <div className="self-stretch w-full max-w-[353px] flex flex-row gap-2 justify-between items-center">
          <p className="text-text font-['Inter'] text-[17px] font-semibold leading-[1.3] tracking-[-0.01em]">Nearby</p>
          <p className="text-brand font-['Inter'] text-[13px] font-medium leading-[1.4]">Map view</p>
        </div>
        <div className="self-stretch w-full max-w-[353px] flex flex-row gap-[14px] p-3 items-center rounded-[18px] bg-surface shadow-[0px_4px_14px_0px_rgba(15,_23,_42,_0.05)]">
          <div className="w-16 h-16 rounded-[14px] relative">
            <div className="absolute left-[-30px] top-0 w-31 h-[69px] bg-[linear-gradient(180deg,_#8FCDF2_0%,_#E4F3FB_100%)]">
              <div className="absolute left-[81.84px] top-[12.42px] w-[15.84px] h-[15.87px] rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,_#FFF8E1_0%,_#FFD36B_100%)]"></div>
              <div className="absolute left-0 top-[20.7px] w-31 h-[48.3px] bg-[linear-gradient(180deg,_#9CB7D8_0%,_#C9D9EC_100%)]"></div>
              <div className="absolute left-0 top-[33.12px] w-31 h-[35.88px] bg-[linear-gradient(180deg,_#4F9E8F_0%,_#86C4B2_100%)]"></div>
              <div className="absolute left-[38.58px] top-[24.15px] w-[6.54px] h-[5.52px] bg-[rgba(255,_255,_255,_0.85)]"></div>
              <div className="absolute left-0 top-[53.63px] w-31 h-[15.37px] bg-[linear-gradient(180deg,_#1E5E54_0%,_#2E7A6A_100%)]"></div>
            </div>
          </div>
          <div className="flex-1 w-full flex flex-col gap-[3px] items-start">
            <p className="text-text font-['Inter'] text-[15px] font-semibold leading-[1.4]">Lake Agnes Teahouse</p>
            <p className="text-muted font-['Inter'] text-[13px] font-medium leading-[1.4]">Lake Louise, AB  ·  7.4 km  ·  Moderate</p>
          </div>
          <div className="w-5 h-5 relative">
            <div className="absolute left-[7.92px] top-[5px] w-[5px] h-[10px] border-[2px] border-muted"></div>
          </div>
        </div>
        <div className="self-stretch w-full max-w-[353px] flex flex-row gap-[14px] p-3 items-center rounded-[18px] bg-surface shadow-[0px_4px_14px_0px_rgba(15,_23,_42,_0.05)]">
          <div className="w-16 h-16 rounded-[14px] relative">
            <div className="absolute left-[-30px] top-0 w-full max-w-[360px] h-50 bg-[linear-gradient(180deg,_#4A3A8E_0%,_#C46A96_50%,_#FFB37A_100%)]">
              <div className="absolute left-[237.6px] top-9 w-[46px] h-[46px] rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,_#FFF1D6_0%,_#FF9A62_100%)]"></div>
              <div className="absolute left-0 top-15 w-full max-w-[360px] h-35 bg-[linear-gradient(180deg,_#7B5DA0_0%,_#A07EBB_100%)]"></div>
              <div className="absolute left-0 top-24 w-full max-w-[360px] h-26 bg-[linear-gradient(180deg,_#3F4079_0%,_#5C5C98_100%)]"></div>
              <div className="absolute left-28 top-[70px] w-[19px] h-4 bg-[rgba(255,_255,_255,_0.85)]"></div>
              <div className="absolute left-0 top-[155.44px] w-full max-w-[360px] h-[44.56px] bg-[linear-gradient(180deg,_#1C2046_0%,_#2A2E5F_100%)]"></div>
            </div>
          </div>
          <div className="flex-1 w-full flex flex-col gap-[3px] items-start">
            <p className="text-text font-['Inter'] text-[15px] font-semibold leading-[1.4]">Sulphur Ridge Lookout</p>
            <p className="text-muted font-['Inter'] text-[13px] font-medium leading-[1.4]">Banff, AB  ·  4.1 km  ·  Hard</p>
          </div>
          <div className="w-5 h-5 relative">
            <div className="absolute left-[7.92px] top-[5px] w-[5px] h-[10px] border-[2px] border-muted"></div>
          </div>
        </div>
      </div>
      <div className="absolute left-0 top-[766px] w-full min-h-[86px] flex flex-row pt-[10px] justify-around items-start bg-surface border-t border-border backdrop-blur-[12px]">
        <div className="w-full max-w-[72px] flex flex-col gap-1 items-center">
          <div className="w-6 h-6 relative">
            <div className="absolute left-[3px] top-[3px] w-[18px] h-[18px] border-[2px] border-brand"></div>
          </div>
          <p className="text-brand font-['Inter'] text-[11px] font-medium leading-[1.3] tracking-[0.01em]">Explore</p>
        </div>
        <div className="w-full max-w-[72px] flex flex-col gap-1 items-center">
          <div className="w-6 h-6 relative">
            <div className="absolute left-[6.5px] top-1 w-[11px] h-[16.5px] border-[2px] border-muted"></div>
          </div>
          <p className="text-muted font-['Inter'] text-[11px] font-medium leading-[1.3] tracking-[0.01em]">Saved</p>
        </div>
        <div className="w-full max-w-[72px] flex flex-col gap-1 items-center">
          <div className="w-6 h-6 relative">
            <div className="absolute left-[3px] top-[5px] w-[18px] h-[14px] border-[2px] border-muted"></div>
          </div>
          <p className="text-muted font-['Inter'] text-[11px] font-medium leading-[1.3] tracking-[0.01em]">Activity</p>
        </div>
        <div className="w-full max-w-[72px] flex flex-col gap-1 items-center">
          <div className="w-6 h-6 relative">
            <div className="absolute left-[4.5px] top-1 w-[15px] h-[16.5px] border-[2px] border-muted"></div>
          </div>
          <p className="text-muted font-['Inter'] text-[11px] font-medium leading-[1.3] tracking-[0.01em]">Profile</p>
        </div>
        <div className="absolute left-[129.5px] top-[73px] w-[134px] h-[5px] rounded-[3px] bg-text"></div>
      </div>
    </div>
  );
}
