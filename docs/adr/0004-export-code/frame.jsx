import "./home-light.css";

export function HomeLight() {
  return (
    <div className="home-light">
      <div className="status-bar">
        <p className="layer-9-41">9:41</p>
        <div className="indicators">
          <div className="signal">
            <div className="bar-1"></div>
            <div className="bar-2"></div>
            <div className="bar-3"></div>
            <div className="bar-4"></div>
          </div>
          <div className="battery">
            <div className="level"></div>
          </div>
        </div>
      </div>
      <div className="content">
        <div className="header">
          <div className="greeting">
            <p className="hello">Good morning, Maya</p>
            <p className="headline">Where to today?</p>
          </div>
          <div className="avatar">
            <p className="mc">MC</p>
          </div>
        </div>
        <div className="search">
          <div className="query">
            <div className="icon-search">
              <div className="search-2"></div>
            </div>
            <p className="placeholder">Search trails, peaks, lakes</p>
          </div>
          <div className="filters">
            <div className="sliders"></div>
          </div>
        </div>
        <div className="filters-2">
          <Chip />
          <Chip selected="Off" />
          <Chip selected="Off" />
          <Chip selected="Off" />
        </div>
        <div className="section-featured-trail">
          <p className="title">Featured trail</p>
          <p className="link">See all</p>
        </div>
        <div className="featured">
          <TrailCard />
        </div>
        <div className="section-nearby">
          <p className="title-2">Nearby</p>
          <p className="link-2">Map view</p>
        </div>
        <div className="trail-row">
          <TrailRow details="Lake Louise, AB  ·  7.4 km  ·  Moderate" title="Lake Agnes Teahouse" />
        </div>
        <div className="trail-row-2">
          <TrailRow details="Banff, AB  ·  4.1 km  ·  Hard" title="Sulphur Ridge Lookout" />
        </div>
      </div>
      <div className="tab-bar">
        <div className="tab-explore">
          <div className="icon">
            <div className="compass"></div>
          </div>
          <p className="label">Explore</p>
        </div>
        <div className="tab-saved">
          <div className="icon-2">
            <div className="bookmark"></div>
          </div>
          <p className="label-2">Saved</p>
        </div>
        <div className="tab-activity">
          <div className="icon-3">
            <div className="activity"></div>
          </div>
          <p className="label-3">Activity</p>
        </div>
        <div className="tab-profile">
          <div className="icon-4">
            <div className="user"></div>
          </div>
          <p className="label-4">Profile</p>
        </div>
        <div className="home-indicator"></div>
      </div>
    </div>
  );
}

/* home-light.css */
:root {
  --color-bg: #F4F6F8;
  --color-text: #0F172A;
  --color-muted: #64748B;
  --color-field: #EAEEF3;
  --color-brand: #0E7C66;
  --color-surface: rgba(255, 255, 255, 0.86);
  --color-border: #E3E8EF;
}
.home-light {
  position: relative;
  width: 393px;
  height: 852px;
  background: var(--color-bg, #F4F6F8);
}
.status-bar {
  position: absolute;
  left: 0px;
  top: 0px;
  width: 393px;
  height: 48px;
  display: flex;
  flex-direction: row;
  gap: 0px;
  padding: 6px 30px 0px 30px;
  justify-content: space-between;
  align-items: center;
}
.layer-9-41 {
  color: var(--color-text, #0F172A);
  font-family: "Inter";
  font-size: 15px;
  font-weight: 600;
  line-height: 140%;
}
.indicators {
  display: flex;
  flex-direction: row;
  gap: 6px;
  padding: 0px 0px 0px 0px;
  justify-content: flex-start;
  align-items: center;
}
.signal {
  display: flex;
  flex-direction: row;
  gap: 2px;
  padding: 0px 0px 0px 0px;
  justify-content: flex-start;
  align-items: flex-end;
}
.bar-1 {
  width: 3px;
  height: 4px;
  border-radius: 1px;
  background: var(--color-text, #0F172A);
}
.bar-2 {
  width: 3px;
  height: 6px;
  border-radius: 1px;
  background: var(--color-text, #0F172A);
}
.bar-3 {
  width: 3px;
  height: 8px;
  border-radius: 1px;
  background: var(--color-text, #0F172A);
}
.bar-4 {
  width: 3px;
  height: 10px;
  border-radius: 1px;
  background: var(--color-text, #0F172A);
}
.battery {
  width: 25px;
  height: 12px;
  border-radius: 3.5px;
  border: 1px solid var(--color-text, #0F172A);
  position: relative;
}
.level {
  position: absolute;
  left: 2px;
  top: 2px;
  width: 17px;
  height: 8px;
  border-radius: 1.5px;
  background: var(--color-text, #0F172A);
}
.content {
  position: absolute;
  left: 0px;
  top: 48px;
  width: 393px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 10px 20px 0px 20px;
  justify-content: flex-start;
  align-items: flex-start;
}
.header {
  align-self: stretch;
  width: 353px;
  display: flex;
  flex-direction: row;
  gap: 12px;
  padding: 0px 0px 0px 0px;
  justify-content: space-between;
  align-items: center;
}
.greeting {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0px 0px 0px 0px;
  justify-content: flex-start;
  align-items: flex-start;
}
.hello {
  color: var(--color-muted, #64748B);
  font-family: "Inter";
  font-size: 13px;
  font-weight: 500;
  line-height: 140%;
}
.headline {
  color: var(--color-text, #0F172A);
  font-family: "Inter";
  font-size: 28px;
  font-weight: 700;
  line-height: 120%;
  letter-spacing: -0.02em;
}
.avatar {
  width: 46px;
  height: 46px;
  display: flex;
  flex-direction: row;
  gap: 0px;
  padding: 0px 0px 0px 0px;
  justify-content: center;
  align-items: center;
  border-radius: 23px;
  background: linear-gradient(135deg, #FF9A62 0%, #E2557A 100%);
}
.mc {
  color: #FFFFFF;
  font-family: "Inter";
  font-size: 15px;
  font-weight: 600;
  line-height: 140%;
}
.search {
  align-self: stretch;
  width: 353px;
  height: 50px;
  display: flex;
  flex-direction: row;
  gap: 10px;
  padding: 0px 16px 0px 16px;
  justify-content: space-between;
  align-items: center;
  border-radius: 14px;
  background: var(--color-field, #EAEEF3);
}
.query {
  display: flex;
  flex-direction: row;
  gap: 10px;
  padding: 0px 0px 0px 0px;
  justify-content: flex-start;
  align-items: center;
}
.icon-search {
  width: 20px;
  height: 20px;
  position: relative;
}
.search-2 {
  position: absolute;
  left: 3.33px;
  top: 3.33px;
  width: 13.75px;
  height: 13.75px;
  border: 2px solid var(--color-muted, #64748B);
}
.placeholder {
  color: var(--color-muted, #64748B);
  font-family: "Inter";
  font-size: 15px;
  font-weight: 400;
  line-height: 150%;
}
.filters {
  width: 20px;
  height: 20px;
  position: relative;
}
.sliders {
  position: absolute;
  left: 3.33px;
  top: 3.75px;
  width: 13.33px;
  height: 12.5px;
  border: 2px solid var(--color-text, #0F172A);
}
.filters-2 {
  display: flex;
  flex-direction: row;
  gap: 8px;
  padding: 0px 0px 0px 0px;
  justify-content: flex-start;
  align-items: center;
}
.section-featured-trail {
  align-self: stretch;
  width: 353px;
  display: flex;
  flex-direction: row;
  gap: 8px;
  padding: 0px 0px 0px 0px;
  justify-content: space-between;
  align-items: center;
}
.title {
  color: var(--color-text, #0F172A);
  font-family: "Inter";
  font-size: 17px;
  font-weight: 600;
  line-height: 130%;
  letter-spacing: -0.01em;
}
.link {
  color: var(--color-brand, #0E7C66);
  font-family: "Inter";
  font-size: 13px;
  font-weight: 500;
  line-height: 140%;
}
.featured {
  align-self: stretch;
}
.section-nearby {
  align-self: stretch;
  width: 353px;
  display: flex;
  flex-direction: row;
  gap: 8px;
  padding: 0px 0px 0px 0px;
  justify-content: space-between;
  align-items: center;
}
.title-2 {
  color: var(--color-text, #0F172A);
  font-family: "Inter";
  font-size: 17px;
  font-weight: 600;
  line-height: 130%;
  letter-spacing: -0.01em;
}
.link-2 {
  color: var(--color-brand, #0E7C66);
  font-family: "Inter";
  font-size: 13px;
  font-weight: 500;
  line-height: 140%;
}
.trail-row {
  align-self: stretch;
}
.trail-row-2 {
  align-self: stretch;
}
.tab-bar {
  position: absolute;
  left: 0px;
  top: 766px;
  width: 393px;
  height: 86px;
  display: flex;
  flex-direction: row;
  gap: 0px;
  padding: 10px 0px 0px 0px;
  justify-content: space-around;
  align-items: flex-start;
  background: var(--color-surface, rgba(255, 255, 255, 0.86));
  border-top: 1px solid var(--color-border, #E3E8EF);
  backdrop-filter: blur(12px);
}
.tab-explore {
  width: 72px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0px 0px 0px 0px;
  justify-content: flex-start;
  align-items: center;
}
.icon {
  width: 24px;
  height: 24px;
  position: relative;
}
.compass {
  position: absolute;
  left: 3px;
  top: 3px;
  width: 18px;
  height: 18px;
  border: 2px solid var(--color-brand, #0E7C66);
}
.label {
  color: var(--color-brand, #0E7C66);
  font-family: "Inter";
  font-size: 11px;
  font-weight: 500;
  line-height: 130%;
  letter-spacing: 0.01em;
}
.tab-saved {
  width: 72px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0px 0px 0px 0px;
  justify-content: flex-start;
  align-items: center;
}
.icon-2 {
  width: 24px;
  height: 24px;
  position: relative;
}
.bookmark {
  position: absolute;
  left: 6.5px;
  top: 4px;
  width: 11px;
  height: 16.5px;
  border: 2px solid var(--color-muted, #64748B);
}
.label-2 {
  color: var(--color-muted, #64748B);
  font-family: "Inter";
  font-size: 11px;
  font-weight: 500;
  line-height: 130%;
  letter-spacing: 0.01em;
}
.tab-activity {
  width: 72px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0px 0px 0px 0px;
  justify-content: flex-start;
  align-items: center;
}
.icon-3 {
  width: 24px;
  height: 24px;
  position: relative;
}
.activity {
  position: absolute;
  left: 3px;
  top: 5px;
  width: 18px;
  height: 14px;
  border: 2px solid var(--color-muted, #64748B);
}
.label-3 {
  color: var(--color-muted, #64748B);
  font-family: "Inter";
  font-size: 11px;
  font-weight: 500;
  line-height: 130%;
  letter-spacing: 0.01em;
}
.tab-profile {
  width: 72px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0px 0px 0px 0px;
  justify-content: flex-start;
  align-items: center;
}
.icon-4 {
  width: 24px;
  height: 24px;
  position: relative;
}
.user {
  position: absolute;
  left: 4.5px;
  top: 4px;
  width: 15px;
  height: 16.5px;
  border: 2px solid var(--color-muted, #64748B);
}
.label-4 {
  color: var(--color-muted, #64748B);
  font-family: "Inter";
  font-size: 11px;
  font-weight: 500;
  line-height: 130%;
  letter-spacing: 0.01em;
}
.home-indicator {
  position: absolute;
  left: 129.5px;
  top: 73px;
  width: 134px;
  height: 5px;
  border-radius: 3px;
  background: var(--color-text, #0F172A);
}
