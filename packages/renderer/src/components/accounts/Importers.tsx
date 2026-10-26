import logsIcon from '../../assets/card-text.svg';
import settingsIcon from '../../assets/gear.svg';
import resultsIcon from '../../assets/results.svg';
import syncMortgageIcon from '../../assets/sync-mortgage.svg';
import syncOneIcon from '../../assets/sync-one.svg';
import {
  AccountStatus,
  ModalStatus,
  type OutputVendorName,
  AccountType as TypeOfAccount,
  type Account as AccountType,
} from '../../types';
import Account, { type ActionButton } from './Account';
import NewAccount from './NewAccount';
import { useConfigStore } from '../../store/ConfigStore';

interface ImportersProps {
  accounts: AccountType[];
  isScraping: boolean;
  showModal: (AccountType: AccountType, ModalStatus: ModalStatus) => void;
  onScrapeOne?: (accountId: string, mortgage?: 'with' | 'without') => void;
  handleNewAccountClicked?: () => void;
}

function Importers({ accounts, isScraping, showModal, onScrapeOne, handleNewAccountClicked }: ImportersProps) {
  const configStore = useConfigStore();
  return (
    <>
      {accounts.map((account) => {
        return (
          <Account
            key={account.id}
            account={account}
            onToggleActive={() => configStore.toggleImporterActive(account.id)}
            disabled={isScraping}
            actionButtons={getActionButtons(
              showModal,
              account,
              isScraping,
              () => {
                configStore.openResults(account.companyId as OutputVendorName);
              },
              onScrapeOne
                ? (mortgage) => onScrapeOne(account.id, hasMortgage(account) ? mortgage : undefined)
                : undefined,
            )}
          />
        );
      })}
      {handleNewAccountClicked ? <NewAccount onClick={handleNewAccountClicked} /> : null}
    </>
  );
}

// בפאג"י ובבינלאומי אפשר לבחור אם לקרוא גם את המשכנתא
const hasMortgage = (account: AccountType) => account.companyId === 'pagi' || account.companyId === 'beinleumi';

export function getActionButtons(
  showModal: (AccountType: AccountType, ModalStatus: ModalStatus) => void,
  account: AccountType,
  isScraping: boolean,
  openResultsHandler?: () => void,
  scrapeOneHandler?: (mortgage?: 'with' | 'without') => void,
): ActionButton[] {
  const logsActionButton = {
    icon: logsIcon,
    clickHandler: () => showModal(account, ModalStatus.LOGS),
    tooltipText: 'לוגים',
  };

  const accountSettingsActionButton = {
    icon: settingsIcon,
    clickHandler: () =>
      showModal(
        account,
        account.type === TypeOfAccount.IMPORTER ? ModalStatus.IMPORTER_SETTINGS : ModalStatus.EXPORTER_SETTINGS,
      ),
    tooltipText: 'הגדרות',
  };

  const actionButtons: ActionButton[] = [];

  const shouldLog = account.status !== AccountStatus.PENDING && account.status !== AccountStatus.IDLE;

  const openResultsButton = {
    icon: resultsIcon,
    tooltipText: 'פתיחת תוצאות',
    clickHandler: openResultsHandler,
  };

  if (shouldLog) {
    actionButtons.push(logsActionButton);
  }

  if (!isScraping && scrapeOneHandler && account.type === TypeOfAccount.IMPORTER) {
    if (hasMortgage(account)) {
      actionButtons.push({
        icon: syncOneIcon,
        clickHandler: () => scrapeOneHandler('without'),
        tooltipText: 'סנכרון רק החשבון הזה, בלי משכנתא',
      });
      actionButtons.push({
        icon: syncMortgageIcon,
        clickHandler: () => scrapeOneHandler('with'),
        tooltipText: 'סנכרון רק החשבון הזה, כולל משכנתא',
      });
    } else {
      actionButtons.push({
        icon: syncOneIcon,
        clickHandler: () => scrapeOneHandler(),
        tooltipText: 'סנכרון רק החשבון הזה',
      });
    }
  }

  if (!isScraping) {
    actionButtons.push(accountSettingsActionButton);
  }

  if (account.type === TypeOfAccount.EXPORTER) {
    actionButtons.push(openResultsButton);
  }

  return actionButtons;
}

export default Importers;
