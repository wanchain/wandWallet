import BigNumber from 'bignumber.js';
import intl from 'react-intl-universal';
import React, { Component } from 'react';
import { observer, inject } from 'mobx-react';
import { Button, Modal, Form, Icon, message } from 'antd';
import { signTransaction } from 'componentUtils/trezor';
import { toWei } from 'utils/support.js';

import style from 'components/Staking/MyValidatorsList/index.less';
import PwdForm from 'componentUtils/PwdForm';
import CommonFormItem from 'componentUtils/CommonFormItem';
import DelegationConfirmForm from './DelegationConfirmForm';
import { WALLETID } from 'utils/settings';
import { checkAmountUnit, getContractAddr, getNonce, getGasPrice, getChainId, getValueByAddrInfo, getStoremanContractData } from 'utils/helper';

const ACTION = 'delegateClaim'
const pu = require('promisefy-util');
const Confirm = Form.create({ name: 'DelegationConfirmForm' })(DelegationConfirmForm);

@inject(stores => ({
  settings: stores.session.settings,
  addrInfo: stores.wanAddress.addrInfo,
  updateStakeInfo: () => stores.staking.updateStakeInfo(),
  updateTransHistory: () => stores.wanAddress.updateTransHistory(),
}))

@observer
class InForm extends Component {
  state = {
    confirmVisible: false,
    confirmLoading: false,
  };

  componentWillUnmount () {
    this.setState = (state, callback) => {
      return false;
    };
  }

  checkAmount = (rule, value, callback) => {
    let { form } = this.props;
    let balance = form.getFieldValue('balance');
    if (value === undefined || !checkAmountUnit(18, value)) {
      callback(intl.get('Common.invalidAmount'));
    }
    if (new BigNumber(value).lt(0)) {
      callback(intl.get('StakeInForm.stakeTooLow'));
      return;
    }
    if (new BigNumber(value).minus(balance).gte(0)) {
      callback(intl.get('SendNormalTrans.hasBalance'));
      return;
    }
    callback();
  }

  showConfirmForm = () => {
    let { form, settings, record, addrInfo } = this.props;
    let balance = addrInfo[record.myAddress.type][record.myAddress.addr].balance;
    form.validateFields(err => {
      if (err) return;
      if (new BigNumber(balance).minus(form.getFieldValue('amount')).lte(0)) {
        message.error(intl.get('NormalTransForm.overBalance'));
        return;
      }

      let pwd = form.getFieldValue('pwd');
      if (!settings.reinput_pwd) {
        this.setState({ confirmVisible: true });
      } else {
        wand.request('phrase_checkPwd', { pwd }, err => {
          if (err) {
            message.warn(intl.get('Backup.invalidPassword'));
          } else {
            this.setState({ confirmVisible: true });
          }
        })
      }
    })
  }

  onSend = async () => {
    this.setState({ confirmLoading: true });
    let { record, form } = this.props;
    let { type, path, addr: from } = record.myAddress;
    let amount = form.getFieldValue('amount');
    let walletID = type !== 'normal' ? WALLETID[type.toUpperCase()] : WALLETID.NATIVE;
    let tx = {
      from,
      amount,
      walletID,
      wAddr: record.wAddr,
      BIP44Path: record.myAddress.path,
    };

    if (WALLETID.TREZOR === walletID) {
      await this.trezorDelegationAppend(path, from.toLowerCase(), amount);
      this.setState({ confirmVisible: false });
      this.props.onSend(walletID);
    } else {
      if (walletID === WALLETID.LEDGER) {
        message.info(intl.get('Ledger.signTransactionInLedger'))
      }
      wand.request('storeman_openStoremanAction', { tx, action: ACTION }, (err, ret) => {
        if (err) {
          message.warn(intl.get('ValidatorRegister.topUpFailed'));
        } else {
          console.log('validatorIn ret:', ret);
        }
        this.setState({ confirmVisible: false });
        this.props.onSend();
      });
    }
  }

  trezorDelegationAppend = async (path, from, value) => {
    let { record } = this.props;
    try {
      let { chainId, nonce, gasPrice, data, to } = await Promise.all([getChainId(), getNonce(from, 'wan'), getGasPrice('wan'), getStoremanContractData(ACTION, record.wAddr, value), getContractAddr()]);
      let rawTx = {
        to,
        from,
        data,
        chainId,
        Txtype: 1,
        value: toWei(value),
        nonce: '0x' + nonce.toString(16),
        gasLimit: '0x' + Number(200000).toString(16),
        gasPrice: toWei(gasPrice, 'gwei'),
      };
      let raw = await pu.promisefy(signTransaction, [path, rawTx], this);// Trezor sign

      // Send register validator
      let txHash = await pu.promisefy(wand.request, ['transaction_raw', { raw, chainType: 'WAN' }], this);
      let params = {
        txHash,
        from: from.toLowerCase(),
        to: rawTx.to,
        value: rawTx.value,
        gasPrice: rawTx.gasPrice,
        gasLimit: rawTx.gasLimit,
        nonce: rawTx.nonce,
        srcSCAddrKey: 'WAN',
        srcChainType: 'WAN',
        tokenSymbol: 'WAN',
        status: 'Sending',
      };
      let satellite = {
        wAddr: record.wAddr,
        annotate: 'StoremanDelegateClaim',
      }

      // save register validator history into DB
      await pu.promisefy(wand.request, ['storeman_insertStoremanTransToDB', { tx: params, satellite }], this);
      this.props.updateStakeInfo();
      this.props.updateTransHistory();
    } catch (error) {
      console.log('Trezor validator append failed:', error);
      message.error(intl.get('ValidatorRegister.topUpFailed'));
    }
  }

  onConfirmCancel = () => {
    this.setState({ confirmVisible: false, confirmLoading: false });
  }

  render () {
    const { onCancel, form, settings, record, addrInfo } = this.props;
    let balance = getValueByAddrInfo(record.myAddress.addr, 'balance', addrInfo);
    let showConfirmItem = { withdrawable: true, storeman: true, account: true };

    return (
      <div>
        <Modal visible closable={false} destroyOnClose={true} title='Delegation Claim' className="validator-register-modal"
        footer={[
            <Button key="back" className="cancel" onClick={onCancel}>{intl.get('Common.cancel')}</Button>,
            <Button key="submit" type="primary" onClick={this.showConfirmForm}>{intl.get('Common.next')}</Button>,
          ]}
        >
          <div className="validator-bg">
            <div className="stakein-title">Storeman Account</div>
            <CommonFormItem form={form} formName='stake' disabled={true}
              options={{ initialValue: record.stake, rules: [{ required: true }] }}
              title='Stake'
            />
            <CommonFormItem form={form} formName='Incentive' disabled={true}
              options={{ initialValue: record.incentive, rules: [{ required: true }] }}
              title='Incentive'
            />
            <CommonFormItem form={form} formName='storeman' disabled={true}
              options={{ initialValue: record.wAddr, rules: [{ required: true }] }}
              title='Storeman'
            />
            <CommonFormItem form={form} formName='withdrawable' disabled={true}
              options={{ initialValue: record.reward, rules: [{ required: true }] }}
              title='Withdrawable Amount'
            />
          </div>
          <div className="validator-bg">
            <div className="stakein-title">{intl.get('ValidatorRegister.myAccount')}</div>
            <CommonFormItem form={form} formName='myAccount' disabled={true}
              options={{ initialValue: record.account }}
              prefix={<Icon type="credit-card" className="colorInput" />}
              title={intl.get('ValidatorRegister.address')}
            />
            <CommonFormItem form={form} formName='balance' disabled={true}
              options={{ initialValue: balance }}
              prefix={<Icon type="credit-card" className="colorInput" />}
              title={intl.get('ValidatorRegister.balance')}
            />
            { settings.reinput_pwd && <PwdForm form={form}/> }
          </div>
        </Modal>
        { this.state.confirmVisible && <Confirm confirmLoading={this.state.confirmLoading} showConfirmItem={showConfirmItem} onCancel={this.onConfirmCancel} onSend={this.onSend} record={record} title={intl.get('NormalTransForm.ConfirmForm.transactionConfirm')} /> }
      </div>
    );
  }
}

const DelegationInForm = Form.create({ name: 'InForm' })(InForm);
class OsmDelegateClaim extends Component {
  state = {
    visible: false
  }

  handleStateToggle = () => {
    this.setState(state => ({ visible: !state.visible }));
  }

  handleSend = () => {
    this.setState({ visible: false });
  }

  render () {
    return (
      <div>
        <Button className={style.modifyTopUpBtn} onClick={this.handleStateToggle} />
        {this.state.visible && <DelegationInForm onCancel={this.handleStateToggle} onSend={this.handleSend} record={this.props.record} />}
      </div>
    );
  }
}

export default OsmDelegateClaim;